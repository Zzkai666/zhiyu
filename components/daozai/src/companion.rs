//! ResearchDesk child transport: inherited pipes only, no account tokens or public service.
use std::io::{BufRead,Write};
use std::sync::{Mutex,OnceLock,atomic::{AtomicU64,Ordering}};
use eframe::egui;
use serde_json::{Value,json};
use crate::{app::App,paint::{Card,H},theme::{self,W}};
#[derive(Default,Clone)]
pub struct State { pub web_requests:Vec<Value>,pub web_active:bool, pub snapshot:Value,pub busy:bool,pub error:String,pub notice:String,pub closing:bool,pub settings:bool,pub host:Option<crate::settings_host::Host> }
static STATE:OnceLock<Mutex<State>>=OnceLock::new();
static SERIAL:AtomicU64=AtomicU64::new(1);
pub fn enabled()->bool{std::env::var("DAOZAI_RESEARCHDESK").as_deref()==Ok("1")}
fn state()->&'static Mutex<State>{STATE.get_or_init(||Mutex::new(State::default()))}
pub fn read()->State{state().lock().unwrap_or_else(|e|e.into_inner()).clone()}
pub fn focus_progress()->Option<(f32,f32,bool)>{if !enabled(){return None};let s=state().lock().unwrap_or_else(|e|e.into_inner());let f=&s.snapshot["focus"];if f.is_null(){return None};let total=f["plannedSeconds"].as_f64()? as f32;let elapsed=f["elapsedSeconds"].as_f64()? as f32;Some(((total-elapsed).max(0.0),total,f["state"].as_str()==Some("running")))}
pub fn widget_enabled()->bool{state().lock().unwrap_or_else(|e|e.into_inner()).snapshot["desktop"]["enabled"].as_bool().unwrap_or(true)}
pub fn desktop_autostart()->bool{state().lock().unwrap_or_else(|e|e.into_inner()).snapshot["desktop"]["autostart"].as_bool().unwrap_or(false)}
pub fn toggle_autostart(){send("desktop-autostart",json!({"enabled":!desktop_autostart()}))}
pub fn web_active()->bool{state().lock().unwrap_or_else(|e|e.into_inner()).web_active}
pub fn take_web_requests()->Vec<Value>{std::mem::take(&mut state().lock().unwrap_or_else(|e|e.into_inner()).web_requests)}
pub fn read_host()->Option<crate::settings_host::Host>{state().lock().unwrap_or_else(|e|e.into_inner()).host.clone()}
pub fn request_settings(){send("open-settings",json!({}))}
pub fn take_settings()->bool{let mut s=state().lock().unwrap_or_else(|e|e.into_inner());std::mem::take(&mut s.settings)}
pub fn start(ctx:egui::Context){
 std::thread::spawn(move||{
  for line in std::io::stdin().lock().lines(){
   let Ok(line)=line else{break};if line.len()>1024*1024{break}
   let Ok(v)=serde_json::from_str::<Value>(&line) else{continue};
   {let mut s=state().lock().unwrap_or_else(|e|e.into_inner());
    match v["type"].as_str().unwrap_or(""){
     "snapshot"=>s.snapshot=v["data"].clone(),
     "result"=>{s.busy=false;s.error=v["error"].as_str().unwrap_or("").to_owned();s.notice=v["notice"].as_str().unwrap_or("").to_owned();},
     "settings"=>s.settings=true,
     "settings-api"=>{if s.web_requests.len()<32{if v["action"]=="open"{s.web_active=true}if v["action"]=="close"{s.web_active=false}s.web_requests.push(v.clone());}},
     "settings-host"=>{if let Ok(host)=serde_json::from_value::<crate::settings_host::Host>(v["host"].clone()){s.settings=host.visible;s.host=Some(host);}},
     "shutdown"=>s.closing=true,
     _=>{}
    }
   }
   ctx.request_repaint();
  }
  state().lock().unwrap_or_else(|e|e.into_inner()).closing=true;
  ctx.request_repaint();
 });
 let _=writeln!(std::io::stdout().lock(),"{}",json!({"type":"ready","protocol":1}));
}
fn new_id()->String{format!("{:016x}{:016x}",std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos() as u64,SERIAL.fetch_add(1,Ordering::Relaxed))}
fn send(action:&str,body:Value){
 let mut s=state().lock().unwrap_or_else(|e|e.into_inner());if s.busy{return}
 let id=new_id();
 s.busy=true;s.error.clear();s.notice.clear();
 let mut out=std::io::stdout().lock();
 if writeln!(out,"{}",json!({"type":"command","requestId":id,"action":action,"body":body})).and_then(|_|out.flush()).is_err(){s.busy=false;s.error="工作台连接已中断，请重新打开软件".into()}
}
fn button(c:&Card,x:f32,y:f32,w:f32,label:&str,id:&str,busy:bool)->bool{
 let r=c.hit(x,y,w,23.0,("research",id));let over=r.hovered();
 c.fill(x,y,w,23.0,6.0,if over{egui::Color32::from_white_alpha(42)}else{egui::Color32::from_white_alpha(20)});
 c.text(x+w/2.0,y+16.0,label,11.0,W::Regular,if busy{theme::GRAY}else{theme::WHITE},H::Center);
 !busy&&r.clicked()
}
fn text(v:&Value,key:&str)->String{v[key].as_str().unwrap_or("").to_owned()}
fn research_page(app:&mut App,c:&Card){
 let s=read();let data=&s.snapshot;let busy=s.busy;
 c.text(44.0,27.0,"研究",15.0,W::Bold,theme::WHITE,H::Left);
 if button(c,280.0,208.0,92.0,"返回待办","personal",false){app.planner_reading=false;app.show_page(crate::app::TODO_PAGE);}
 if data.is_null(){c.text(44.0,80.0,"正在连接工作台…",13.0,W::Regular,theme::GRAY,H::Left);return}
 let focus=&data["focus"];
 if !focus.is_null(){
  let title=text(focus,"title");c.text(44.0,54.0,&c.fit(&title,13.0,W::Bold,326.0),13.0,W::Bold,theme::WHITE,H::Left);
  let planned=focus["plannedSeconds"].as_i64().unwrap_or(0);let elapsed=focus["elapsedSeconds"].as_i64().unwrap_or(0);
  let remaining=(planned-elapsed).max(0);let state=text(focus,"state");
  let label=match state.as_str(){"running"=>"专注中","paused"=>"已暂停","interrupted"=>"上次专注已中断，请核对","review"=>"本次专注待确认",_=>""};
  c.text(44.0,83.0,&format!("{:02}:{:02}  {}",remaining/60,remaining%60,label),19.0,W::Bold,theme::WHITE,H::Left);
  let command=|action:&str,result:&str|send("focus",json!({"id":focus["id"],"revision":focus["revision"],"action":action,"result":result}));
  if state=="running" {
   if button(c,44.0,99.0,80.0,"暂停","pause",busy){command("pause","")}
   if button(c,133.0,99.0,90.0,"结束并确认","stop",busy){command("stop","")}
  }else if state=="paused"||state=="interrupted"{
   if button(c,44.0,99.0,80.0,"继续计时","resume",busy){command("resume","")}
   if button(c,133.0,99.0,90.0,"结束并确认","stop",busy){command("stop","")}
  }else{
   if button(c,44.0,99.0,104.0,"任务已完成","done",busy){command("finish","done")}
   if button(c,158.0,99.0,104.0,"稍后继续","continue",busy){command("finish","continue")}
  }
  if button(c,274.0,99.0,98.0,"查看任务","open-focus",busy){send("open-task",json!({"id":focus["taskId"]}))}
  c.text(44.0,148.0,"记录进度时，可在工作台补充成果。",11.0,W::Regular,theme::GRAY,H::Left);
 }else{
  let recent=&data["recent"];
  if !recent.is_null(){
   c.text(44.0,53.0,&c.fit(&text(recent,"title"),13.0,W::Bold,260.0),13.0,W::Bold,theme::WHITE,H::Left);
   let page=recent["page"].as_u64().unwrap_or(1);
   c.text(44.0,71.0,&format!("上次阅读至第 {} 页",page),11.0,W::Regular,theme::GRAY,H::Left);
   if button(c,304.0,43.0,68.0,"继续阅读","read",busy){send("open-paper",json!({"id":recent["id"]}))}
  }else{
   c.text(44.0,54.0,"导入论文，开始第一次阅读",13.0,W::Regular,theme::GRAY,H::Left);
   if button(c,280.0,43.0,92.0,"打开工作台","home-empty",busy){send("open-home",json!({}))}
  }
  if let Some(tasks)=data["tasks"].as_array(){
   for (i,task) in tasks.iter().take(3).enumerate(){
    let y=86.0+i as f32*32.0;
    c.text(44.0,y+16.0,&c.fit(&text(task,"title"),12.0,W::Regular,206.0),12.0,W::Regular,theme::WHITE,H::Left);
    if button(c,256.0,y,54.0,"查看",&format!("task-{i}"),busy){send("open-task",json!({"id":task["id"]}))}
    if button(c,316.0,y,56.0,"专注",&format!("focus-{i}"),busy){send("focus",json!({"id":new_id(),"action":"start","taskId":task["id"],"taskRevision":task["revision"],"minutes":app.settings.focus_minutes}))}
   }
   if tasks.is_empty(){c.text(44.0,109.0,"论文批注可以创建带来源的研究任务",12.0,W::Regular,theme::GRAY,H::Left);}
  }
 }
 let status=if !s.error.is_empty(){s.error}else if busy{"正在处理…".into()}else{s.notice};
 c.text(44.0,199.0,&c.fit(&status,10.5,W::Regular,328.0),10.5,W::Regular,theme::GRAY,H::Left);
 if button(c,44.0,208.0,114.0,"打开工作台","home",busy){send("open-home",json!({}))}
 if button(c,166.0,208.0,100.0,"联动设置","settings",busy){send("open-settings",json!({}))}
}

pub fn page(app:&mut App,c:&Card){
 let s=read();
 if app.page()==crate::app::FOCUS_PAGE||app.planner_reading||s.snapshot["planner"].is_null(){research_page(app,c);return}
 let b=&s.snapshot["planner"];let busy=s.busy;
 let day=text(b,"day");if app.planner_day!=day{app.planner_day=day;app.planner_completed=false;app.planner_first=0;}
 c.text(44.0,27.0,"待办",15.0,W::Bold,theme::WHITE,H::Left);
 let important=b["important"].as_array().map(|v|v.as_slice()).unwrap_or(&[]);
 if important.is_empty(){
  c.text(44.0,57.0,"重要日期",11.0,W::Bold,theme::GRAY,H::Left);
  c.text(44.0,81.0,"考试和截止时间会一直显示在这里",12.0,W::Regular,theme::WHITE,H::Left);
 }else{
  app.planner_important=app.planner_important.min(important.len()-1);
  let item=&important[app.planner_important];
  let label=match item["milestone"].as_str().unwrap_or(""){"exam"=>"考试","deadline"=>"截止",_=>"重要日期"};
  c.text(44.0,49.0,&format!("{}  {}/{}",label,app.planner_important+1,important.len()),10.5,W::Regular,theme::GRAY,H::Left);
  let title=text(item,"title");
  c.text(44.0,70.0,&c.fit(&title,13.0,W::Bold,250.0),13.0,W::Bold,theme::WHITE,H::Left);
  if c.hit(44.0,51.0,250.0,25.0,"important-open").on_hover_text(&title).clicked(){send("open-planner",json!({}))}
  let date=if text(item,"deadline").is_empty(){text(item,"day")}else{text(item,"deadline")};
  let days=chrono::NaiveDate::parse_from_str(&date,"%Y-%m-%d").ok().zip(chrono::NaiveDate::parse_from_str(&text(b,"day"),"%Y-%m-%d").ok()).map(|(a,z)|(a-z).num_days()).unwrap_or(0);
  let count=if days>0{format!("还有 {} 天",days)}else if days==0{"就是今天".into()}else{format!("已过 {} 天",-days)};
  c.text(372.0,72.0,&count,12.0,W::Bold,if days<=3{theme::RED_TOP}else{theme::WHITE},H::Right);
  c.text(44.0,89.0,&format!("{} {}",date,text(item,"start")),10.5,W::Regular,theme::GRAY,H::Left);
  if important.len()>1{
   if button(c,309.0,35.0,27.0,"‹","prev-important",busy){app.planner_important=(app.planner_important+important.len()-1)%important.len()}
   if button(c,345.0,35.0,27.0,"›","next-important",busy){app.planner_important=(app.planner_important+1)%important.len()}
  }
 }
 let all=b["today"].as_array().map(|v|v.as_slice()).unwrap_or(&[]);
 let done=all.iter().filter(|v|v["done"].as_bool()==Some(true)).count();
 let tasks:Vec<_>=all.iter().filter(|v|v["done"].as_bool().unwrap_or(false)==app.planner_completed).collect();
 c.text(44.0,110.0,if app.planner_completed{"今日已完成"}else{"今日待办"},11.5,W::Bold,theme::WHITE,H::Left);
 if button(c,278.0,95.0,94.0,&if app.planner_completed{"返回待办".into()}else{format!("已完成 {}",done)},"completed",false){app.planner_completed=!app.planner_completed;app.planner_first=0}
 app.planner_first=app.planner_first.min((tasks.len().saturating_sub(1)/3)*3);
 if tasks.is_empty(){c.text(44.0,151.0,if app.planner_completed{"今天还没有完成记录"}else{"今天的清单已清空，按自己的节奏安排"},12.0,W::Regular,theme::GRAY,H::Left);}
 for (index,item) in tasks.iter().skip(app.planner_first).take(3).enumerate(){
  let y=118.0+index as f32*25.0;let completed=item["done"].as_bool().unwrap_or(false);
  let check=c.hit(43.0,y,26.0,23.0,("planner-check",text(item,"id"))).on_hover_text(if completed{"重新打开这一项"}else{"完成这一项"});
  c.stroke(47.0,y+4.0,15.0,15.0,4.0,1.0,theme::GRAY);
  if completed{c.path(&[(49.0,y+11.0),(53.0,y+15.0),(60.0,y+7.0)],1.6,theme::SOFT_GREEN);}
  if !busy&&check.clicked(){send("planner-action",json!({"id":item["id"],"seriesId":item["seriesId"].as_str().unwrap_or(""),"day":item["occurrenceDay"].as_str().unwrap_or(""),"revision":item["revision"],"seriesRevision":item["seriesRevision"].as_i64().unwrap_or(0),"action":if completed{"reopen"}else{"complete"}}))}
  let title=text(item,"title");let shown=c.fit(&title,12.0,W::Regular,220.0);
  c.text(73.0,y+16.0,&shown,12.0,W::Regular,if completed{theme::GRAY}else{theme::WHITE},H::Left);
  if c.hit(73.0,y,220.0,23.0,("planner-title",text(item,"id"))).on_hover_text(&title).clicked(){send("open-planner",json!({}))}
  let suffix=if !text(item,"start").is_empty(){text(item,"start")}else{match item["repeat"].as_str().unwrap_or("none"){"daily"=>"每天".into(),"weekly"=>"每周".into(),_=>"".into()}};
  c.text(372.0,y+16.0,&suffix,10.0,W::Regular,theme::GRAY,H::Right);
 }
 let status=if !s.error.is_empty(){s.error.as_str()}else if busy{"正在保存…"}else{s.notice.as_str()};
 c.text(44.0,202.0,&c.fit(status,10.0,W::Regular,328.0),10.0,W::Regular,theme::GRAY,H::Left);
 if button(c,44.0,210.0,120.0,"打开任务日程","planner-open",busy){send("open-planner",json!({}))}
 if button(c,175.0,210.0,27.0,"‹","prev-todo",busy){app.planner_first=app.planner_first.saturating_sub(3)}
 c.text(230.0,226.0,&format!("{}/{}",if tasks.is_empty(){0}else{app.planner_first/3+1},(tasks.len()+2)/3),10.5,W::Regular,theme::GRAY,H::Center);
 if button(c,257.0,210.0,27.0,"›","next-todo",busy){app.planner_first=(app.planner_first+3).min(tasks.len().saturating_sub(1))}
 if button(c,302.0,210.0,70.0,"更多","more",false){app.planner_more=!app.planner_more}
 if app.planner_more{
  c.fill(160.0,87.0,215.0,120.0,10.0,theme::CARD);
  for(i,label)in ["阅读与专注","原岛仔私人待办","设置"].iter().enumerate(){
   if button(c,169.0,96.0+i as f32*32.0,195.0,label,&format!("more-{i}"),busy){
    app.planner_more=false;
    match i{0=>app.planner_reading=true,1=>app.research_personal=true,_=>request_settings()}
   }
  }
 }
}
