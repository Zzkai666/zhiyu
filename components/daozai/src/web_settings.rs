//! ResearchDesk settings API. UI lives in React; secrets stay in native credential services.
use crate::{app::{App,Cmd},model,mail,calendar};
use serde_json::{Value,json};
use std::{collections::BTreeMap,io::Write};
fn values()->BTreeMap<String,String>{model::read_kv(&model::config_dir().join("settings.txt")).into_iter().collect()}
fn revision(v:&BTreeMap<String,String>)->String{ring::digest::digest(&ring::digest::SHA256,&serde_json::to_vec(v).unwrap()).as_ref().iter().map(|b|format!("{b:02x}")).collect()}
fn text(v:&Value,k:&str)->String{v[k].as_str().unwrap_or("").trim().to_owned()}
pub fn active()->bool{crate::companion::web_active()}
impl App{
 pub fn web_settings_tick(&mut self){
  if active()&&!self.weather.city_input.is_empty(){self.weather.cities.update(&self.weather.city_input,self.t);}
  for request in crate::companion::take_web_requests(){
   let id=request["requestId"].clone();let action=request["action"].as_str().unwrap_or("");let body=&request["body"];
   let result=self.web_action(action,body);
   let response=match result{Ok(())=>json!({"type":"settings-api-result","requestId":id,"data":self.web_snapshot()}),Err(e)=>json!({"type":"settings-api-result","requestId":id,"error":e})};
   let _=writeln!(std::io::stdout().lock(),"{response}");
  }
 }
 fn web_snapshot(&self)->Value{
  let config=values();
  json!({"values":config,"revision":revision(&config),
   "displays":self.displays.iter().map(|d|json!({"id":d.id,"label":d.label})).collect::<Vec<_>>(),
   "mail":{"accounts":self.mail.accounts.iter().map(|a|json!({"email":a.email,"provider":a.provider.key(),"label":a.provider.label(),"enabled":a.enabled,"status":self.mail.status_of(&a.email).label()})).collect::<Vec<_>>(),"note":self.mail.note,"testing":self.mail.testing.is_some(),
    "providers":mail::Provider::ALL.iter().map(|p|{let (label,url)=p.setup_link();json!({"key":p.key(),"label":p.label(),"hint":p.hint(),"guideLabel":label,"url":url})}).collect::<Vec<_>>()},
   "calendar":{"accounts":self.calendar.feeds.iter().map(|f|json!({"provider":f.config.provider.key(),"label":f.config.provider.label(),"username":f.config.username,"connected":f.connected,"error":f.error})).collect::<Vec<_>>(),"note":self.calendar.note,"error":self.calendar.note_error,"testing":self.calendar.testing,
    "providers":calendar::Provider::ALL.iter().map(|p|json!({"key":p.key(),"label":p.label(),"custom":p.custom_server(),"guide":p.guide(),"server":p.server()})).collect::<Vec<_>>()},
   "quota":self.web_quota_snapshot(),
   "water":{"goal":self.water.goal_ml,"remind":self.water.remind},
   "weather":{"results":self.weather.cities.results,"saved":self.settings.weather_saved,"city":self.settings.weather_city,"error":self.weather.error},
   "notifications":{"status":self.listener_status,"connected":self.settings.read_notifications},
   "notificationApps":self.notification_apps.items.iter().map(|(id,label,on)|json!({"id":id,"label":label,"enabled":on})).collect::<Vec<_>>()
  })
 }
 fn web_action(&mut self,action:&str,b:&Value)->Result<(),String>{
  if (action.starts_with("mail-")&&["mail-connect","mail-test","mail-retest"].contains(&action)&&!self.module_on(5))||(action=="calendar-connect"&&!self.module_on(7))||(action.starts_with("weather-")&&!self.module_on(8)){return Err("请先启用对应的小岛功能页面".into())}
  match action{
   "open"|"snapshot"=>{if !model::config_dir().join("settings.txt").exists(){self.settings.save_checked().map_err(|_|"无法初始化小岛设置")?;}},
   "close"=>{self.web_quota_action("quota-cancel",&json!({}))?;},
   "save"=>{
    let mut all=values();if text(b,"revision")!=revision(&all){return Err("设置已由小岛更新，请重新载入后再修改".into())}
    let patch=b["patch"].as_object().ok_or("设置格式无效")?;
    for(k,v)in patch{
     if !all.contains_key(k)||matches!(k.as_str(),"ignored_mail_events"|"render_compat_reason"){return Err("设置项无效".into())}
     let value=v.as_str().ok_or("设置值格式无效")?;
     let schema:Value=serde_json::from_str(include_str!("../assets/researchdesk-fields.json")).unwrap();
     let field=schema.as_array().unwrap().iter().flat_map(|g|g["fields"].as_array().unwrap()).find(|f|f["key"].as_str()==Some(k));
     if let Some(f)=field{
      match f["type"].as_str().unwrap_or(""){
       "bool" if value!="0"&&value!="1"=>return Err("开关状态无效".into()),
       "number"|"time"=>{let n=value.parse::<i64>().map_err(|_|"请输入整数")?;if n<f["min"].as_i64().unwrap()||n>f["max"].as_i64().unwrap(){return Err("数值不在允许范围内".into())}},
       "select"=>{if !f["options"].as_array().unwrap().iter().any(|o|o[0].as_str()==Some(value)){return Err("选项无效".into())}},
       "display"=>{if !value.is_empty()&&!self.displays.iter().any(|d|d.id==value){return Err("显示器已断开，请重新选择".into())}},
       _=>{}
      }
     }else if !["visible_pages","page_order","resident_order","avoid_apps"].contains(&k.as_str()){return Err("设置项不可修改".into())}
     if k=="resident_order"&&!value.is_empty(){let mut order=value.split(',').map(|n|n.parse::<usize>()).collect::<Result<Vec<_>,_>>().map_err(|_|"常驻顺序无效")?;order.sort();if order!=vec![0,1,2,6,7,9]{return Err("常驻组件顺序无效".into())}}
     if k=="avoid_apps"{let list:Vec<(String,String)>=serde_json::from_str(value).map_err(|_|"避让应用列表无效")?;if list.len()>100{return Err("最多设置100个避让应用".into())}}

     if value.len()>16384||value.contains(['\n','\r','\0']){return Err("设置值过长或包含无效内容".into())}
     if k=="visible_pages"&&(value.len()!=9||!value.bytes().all(|x|x==b'0'||x==b'1')||!value.contains('1')){return Err("至少保留一个功能页面".into())}
     if k=="page_order"{let mut list=value.split(',').filter_map(|s|s.parse::<usize>().ok()).collect::<Vec<_>>();list.sort();if list!=(0..9).collect::<Vec<_>>(){return Err("页面顺序无效".into())}}
     if k=="skin"&&!["classic","cream","glass_light","glass","fluid"].contains(&value){return Err("小岛主题无效".into())}
     if k=="island_size"&&value.parse::<u32>().unwrap_or(0)%5!=0{return Err("岛体大小按 5% 调整".into())}
     if k=="render_compat"{all.insert("render_compat_reason".into(),String::new());}
     all.insert(k.clone(),value.into());
    }
    let before=self.settings.clone();
    model::write_kv(&model::config_dir().join("settings.txt"),&all.into_iter().collect::<Vec<_>>()).map_err(|_|"保存失败，原设置保持")?;
    self.settings=model::Settings::load();
    if !before.sit_remind&&self.settings.sit_remind{self.sit_alerted=self.t;}
    if before.mail_sync_operations!=self.settings.mail_sync_operations{self.mail_manage_mode_changed();}
    if before.read_notifications!=self.settings.read_notifications{self.pending.push(if self.settings.read_notifications{Cmd::RequestNotifications}else{Cmd::DisconnectNotifications});}
    for i in 0..9{let on=self.settings.visible_pages[i];if on!=before.visible_pages[i]{self.settings.visible_pages[i]=before.visible_pages[i];self.set_page_visible(i,on);}}
   },
   "notification-connect"=>self.pending.push(Cmd::RequestNotifications),
   "notification-disconnect"=>self.pending.push(Cmd::DisconnectNotifications),
   "notification-app"=>{let id=text(b,"id");let on=b["enabled"].as_bool().ok_or("请选择启用状态")?;let a=self.notification_apps.items.iter_mut().find(|a|a.0==id).ok_or("应用已改变")?;a.2=on;self.notification_apps.save();},
   "mail-connect"|"mail-test"=>{
    let provider=mail::Provider::parse(&text(b,"provider"));let email=text(b,"email");
    let account=mail::Account{email:email.clone(),provider,enabled:true,custom:(provider==mail::Provider::Custom).then(||mail::CustomImap{host:text(b,"host"),port:b["port"].as_u64().unwrap_or(993).min(65535) as u16,username:text(b,"username")})};
    if !email.contains('@'){return Err("请填写邮箱地址".into())}account.endpoint()?;
    let password=b["password"].as_str().unwrap_or("");if password.is_empty(){return Err("请填写邮箱授权码".into())}
    if action=="mail-test"{self.mail.testing=Some(email);self.mail.note="正在测试连接…".into();self.pending.push(Cmd::MailTest(account,password.into()));}
    else{mail::secrets::save(&account.credential_key(),password)?;if let Some(old)=self.mail.accounts.iter_mut().find(|a|a.email.eq_ignore_ascii_case(&email)){*old=account}else{self.mail.accounts.push(account)}self.mail.note="已保存，正在连接…".into();self.mail_accounts_changed();}
   },
   "mail-remove"|"mail-toggle"|"mail-retest"=>{
    let email=text(b,"email");let index=self.mail.accounts.iter().position(|a|a.email==email).ok_or("邮箱已移除")?;
    if action=="mail-remove"{let a=self.mail.accounts.remove(index);mail::secrets::delete(&a.credential_key());self.mail_accounts_changed();}
    else if action=="mail-toggle"{self.mail.accounts[index].enabled=b["enabled"].as_bool().ok_or("状态无效")?;self.mail_accounts_changed();}
    else{let a=self.mail.accounts[index].clone();let secret=mail::secrets::load(&a.credential_key())?;self.mail.testing=Some(email);self.pending.push(Cmd::MailTest(a,secret));}
   },
   "open-page"=>{if !crate::companion::widget_enabled(){return Err("请先在常规设置启用小岛".into())}let page=b["page"].as_u64().filter(|n|*n<9).ok_or("页面无效")?;self.show_page(page as usize);},
   "water-save"=>{let goal=b["goal"].as_u64().filter(|v|*v>=500&&*v<=6000).ok_or("每日目标应在 500–6000 ml 之间")?;self.water.goal_ml=goal as u32;self.water.remind=b["remind"].as_bool().ok_or("提醒状态无效")?;self.water.save();let saved=model::Water::load(&chrono::Local::now().format("%Y-%m-%d").to_string());if saved.goal_ml!=self.water.goal_ml||saved.remind!=self.water.remind{return Err("饮水设置未能保存，请重试".into())}},
   "weather-search"=>{self.weather.city_input=text(b,"query");self.weather.cities.update(&self.weather.city_input,self.t);},
   "weather-use"=>{let p=if b["auto"]==true{None}else{let i=b["index"].as_u64().ok_or("请选择城市")? as usize;Some(if b["saved"]==true{self.settings.weather_saved.get(i)}else{self.weather.cities.results.get(i)}.ok_or("城市列表已改变")?.clone())};self.switch_weather_city(p);},
   "weather-add"=>{let i=b["index"].as_u64().ok_or("请选择城市")? as usize;self.weather.selected_city=Some(self.weather.cities.results.get(i).ok_or("城市列表已改变")?.clone());self.weather.manual_city=true;if !self.add_weather_city(){return Err("城市已保存、列表已满或天气页未启用".into())}},
   "weather-remove"=>{let i=b["index"].as_u64().ok_or("请选择城市")? as usize;let p=self.settings.weather_saved.get(i).ok_or("城市已移除")?.clone();self.remove_weather_city(&p);},
   "weather-refresh"=>{self.weather.refresh(&self.settings.weather_city,self.t);},
   "calendar-select"=>self.select_calendar_provider(calendar::Provider::parse(&text(b,"provider"))),
   "calendar-connect"=>{
    if self.calendar.testing{return Err("日历正在连接，请稍候".into())}
    let p=calendar::Provider::parse(&text(b,"provider"));self.select_calendar_provider(p);
    let user=text(b,"username");let password=b["password"].as_str().unwrap_or("");
    if user.is_empty()||password.is_empty(){return Err("请填写用户名和专用密码".into())}
    let server=if p.custom_server(){Some(calendar::normalize_server(&text(b,"server")).ok_or("请填写 https:// 日历服务器地址")?)}else{None};
    self.calendar.testing=true;self.calendar.test_password=password.into();self.calendar.note="正在连接日历…".into();self.calendar.note_error=false;
    self.pending.push(Cmd::CalendarTest(calendar::Config{provider:p,username:user,href:None,server},password.into()));
   },
   "calendar-sync"=>self.pending.push(Cmd::CalendarSync),
   "calendar-forget"=>{self.select_calendar_provider(calendar::Provider::parse(&text(b,"provider")));self.pending.push(Cmd::CalendarForget);},
   "calendar-import"=>self.pending.push(Cmd::CalendarImport),
   a if a.starts_with("quota-")=>self.web_quota_action(a,b)?,
   _=>return Err("不支持的设置操作".into())
  }Ok(())
 }
}
