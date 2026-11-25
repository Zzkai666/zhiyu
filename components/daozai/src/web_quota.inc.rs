impl App{
 pub(crate) fn web_quota_snapshot(&self)->serde_json::Value{
  use serde_json::json;
  json!({"enabled":self.quota.config.enabled,"compact":self.quota.config.compact,"selected":self.quota.config.selected,"note":self.quota.note,
   "connecting":self.quota.api_connecting.is_some()||self.quota.workbuddy_connecting.is_some()||self.quota.deepseek_connecting.is_some()||self.quota.gemini_connecting.is_some()||self.quota.doubao_connecting.is_some()||self.quota.login.is_some()||self.quota.kiro_connecting.is_some(),
   "providers":Provider::ALL.iter().map(|p|json!({"key":p.name(),"api":p.api_key(),"relay":p.relay()})).collect::<Vec<_>>(),
   "accounts":self.quota.config.accounts.iter().map(|a|{
    let row=self.quota.rows.get(&a.id);
    let windows=row.and_then(|r|r.as_ref().ok()).map(|s|s.rings().iter().map(|w|json!({"label":w.label,"remaining":w.remaining})).collect::<Vec<_>>()).unwrap_or_default();
    json!({"id":a.id,"provider":a.provider.name(),"alias":a.alias,"enabled":a.enabled,"pinned":a.pinned,"selected":self.quota.config.selected==a.id,"color":self.quota.config.colors.get(&a.id).copied().unwrap_or_default().key(),"busy":self.quota.busy.contains(&a.id),"error":self.quota.stale.get(&a.id).cloned().or_else(||row.and_then(|r|r.as_ref().err()).cloned()),"balance":self.quota.balance_text(&a.id),"details":row.and_then(|r|r.as_ref().ok()).map(snapshot_details),"windows":windows})
   }).collect::<Vec<_>>()})
 }
 pub(crate) fn web_quota_action(&mut self,action:&str,b:&serde_json::Value)->Result<(),String>{
  if ["quota-connect","quota-refresh","quota-discover"].contains(&action)&&!self.module_on(6){return Err("请先启用 AI 额度页面".into())}
  let txt=|k:&str|b[k].as_str().unwrap_or("").trim().to_owned();
  match action{
   "quota-cancel"=>{self.quota_close_connection();self.quota.workbuddy_connecting=None;self.quota.deepseek_connecting=None;self.quota.login=None;},
   "quota-discover"=>{self.quota.note=self.quota.config.discover().message();self.quota.config.save_checked()?;},
   "quota-refresh"=>self.pending.push(Cmd::QuotaRefresh),
   "quota-options"=>{if let Some(v)=b["enabled"].as_bool(){self.quota.config.enabled=v}if let Some(v)=b["compact"].as_bool(){self.quota.config.compact=v}self.quota.config.save_checked()?;},
   "quota-remove"=>{let id=txt("id");if !self.quota.config.accounts.iter().any(|a|a.id==id){return Err("账号已移除".into())}self.quota_remove_account(&id);},
   "quota-update"=>{
    let id=txt("id");let a=self.quota.config.accounts.iter_mut().find(|a|a.id==id).ok_or("账号已移除")?;
    if let Some(v)=b["alias"].as_str(){a.alias=v.chars().take(120).collect()}
    if let Some(v)=b["enabled"].as_bool(){a.enabled=v}if let Some(v)=b["pinned"].as_bool(){a.pinned=v}
    if b["selected"]==true{self.quota.config.selected=id.clone();}
    if let Some(color)=b["color"].as_str(){let value=Accent::ALL.into_iter().find(|v|v.key()==color).ok_or("颜色无效")?;self.quota.config.colors.insert(id.clone(),value);}
    if let Some(index)=b["position"].as_u64(){let pos=self.quota.config.accounts.iter().position(|a|a.id==id).unwrap();let a=self.quota.config.accounts.remove(pos);let at=(index as usize).min(self.quota.config.accounts.len());self.quota.config.accounts.insert(at,a);}
    self.quota.config.save_checked()?;
   },
   "quota-connect"=>{
    if self.web_quota_snapshot()["connecting"]==true{return Err("正在连接，请先完成或取消当前连接".into())}
    let p=Provider::ALL.into_iter().find(|p|p.name()==txt("provider")).ok_or("额度服务无效")?;
    let id=txt("id");if !id.is_empty()&&!self.quota.config.accounts.iter().any(|a|a.id==id&&a.provider==p){return Err("账号已改变，请重新选择".into())}
    self.quota.connect_target=(!id.is_empty()).then_some(id.clone());self.quota.connect_open=true;self.quota.provider=p;self.quota.alias=txt("alias");self.quota.note.clear();
    let alias=self.quota.alias.clone();let mode=txt("mode");let source=txt("source");let secret=b["secret"].as_str().unwrap_or("").to_owned();
    let expected=self.quota.config.accounts.iter().find(|a|a.id==id).and_then(|a|a.slot.clone());
    if p.api_key(){if secret.is_empty(){return Err("请填写 API Key".into())}self.quota.api_connecting=Some(if p.relay()&&mode=="auto"{quota::api::Connect::start_auto(source,alias,secret)}else{quota::api::Connect::start(p,source,alias,secret)});}
    else{if p==Provider::Gemini&&mode=="cookie"&&(secret.is_empty()||txt("email").is_empty()){return Err("请填写 Google 邮箱和 Cookie".into())}match p{
     Provider::DeepSeek=>{if secret.is_empty(){return Err("请填写 API Key".into())}self.quota.deepseek_connecting=Some(quota::deepseek::Connect::start(alias,secret));},
     Provider::WorkBuddy=>self.quota.workbuddy_connecting=Some(quota::workbuddy::Connect::start(alias,expected)),
     Provider::Gemini=>self.quota.gemini_connecting=Some(quota::gemini::Connect::start(alias,txt("email"),(!secret.is_empty()).then_some(secret),expected)),
     Provider::Doubao=>{let from=if mode=="local"{quota::doubao::LoginSource::Local}else if mode=="cookie"{if secret.is_empty(){return Err("请填写 Cookie".into())}quota::doubao::LoginSource::Cookie(secret)}else{quota::doubao::LoginSource::Browser};self.quota.doubao_connecting=Some(quota::doubao::Connect::start(alias,from,expected));},
     Provider::GrokBot if mode!="file"=>{if mode=="local"{let path=quota::grok::native_path().ok_or("未找到本机 Grok Bot 登录")?;self.quota.config.import_grok(&path,&alias)?;}else{self.quota_login(alias);}},
     Provider::ZCode if source.is_empty()=>{let path=quota::zcode::path().ok_or("未找到本机 ZCode 登录")?;quota::zcode::add(&mut self.quota.config,&path,&alias)?;},
     Provider::Kiro=>{let path=if source.is_empty(){quota::kiro::path().ok_or("未找到本机 Kiro 登录")?}else{source.into()};self.quota_start_kiro(path);},
     Provider::Claude if mode=="desktop"=>{self.quota.config.connect_claude_desktop(&alias)?;self.pending.push(Cmd::QuotaConnected);},
     Provider::Claude if mode=="code"=>{self.quota.config.connect_claude_code(&alias)?;self.pending.push(Cmd::QuotaConnected);},
     _=>{if source.is_empty(){return Err("请选择登录或用量记录 JSON 文件".into())}self.quota.config.add(p,alias,source.into())?;}
    }}
    self.quota.config.save_checked()?;
   },
   _=>return Err("额度操作无效".into())
  }Ok(())
 }
}
