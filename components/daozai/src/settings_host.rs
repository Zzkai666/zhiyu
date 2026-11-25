//! The original egui settings viewport is a clipped child of the ResearchDesk window.
use serde::{Deserialize,Serialize};
#[derive(Clone,Debug,Deserialize,Serialize)]
pub struct Host {pub parent:String,pub x:i32,pub y:i32,pub width:i32,pub height:i32,pub visible:bool}
pub fn host()->Option<Host>{crate::companion::read_host()}
pub fn configured()->bool{host().is_some()}
pub fn visible()->bool{host().is_some_and(|v|v.visible)}
#[cfg(windows)]
pub fn apply(section:usize)->Result<(),String>{
 use windows::{Win32::{Foundation::{BOOL,HWND,LPARAM,RECT},System::Threading::GetCurrentProcessId,UI::WindowsAndMessaging::*}};
 use std::sync::{Mutex,OnceLock};
 static WINDOW:OnceLock<Mutex<isize>>=OnceLock::new();
 static LAST:OnceLock<Mutex<String>>=OnceLock::new();
 let Some(h)=host() else{return Ok(())};
 let parent_value=h.parent.parse::<isize>().map_err(|_|"设置宿主无效")?;
 let parent=HWND(parent_value as *mut _);
 unsafe extern "system" fn find(hwnd:HWND,param:LPARAM)->BOOL{
  let mut pid=0;GetWindowThreadProcessId(hwnd,Some(&mut pid));
  if pid==GetCurrentProcessId(){let mut title=[0u16;96];let len=GetWindowTextW(hwnd,&mut title);
   if String::from_utf16_lossy(&title[..len as usize])=="ResearchDesk · 小岛设置"{*(param.0 as *mut isize)=hwnd.0 as isize;return BOOL(0)}
  }BOOL(1)
 }
 let mut cache=WINDOW.get_or_init(||Mutex::new(0)).lock().unwrap_or_else(|e|e.into_inner());
 unsafe{
  if *cache==0||!IsWindow(HWND(*cache as *mut _)).as_bool(){let mut result=0isize;let _=EnumWindows(Some(find),LPARAM((&mut result as *mut isize) as isize));*cache=result;}
  if *cache==0{return Err("设置视图正在准备".into())}
  let hwnd=HWND(*cache as *mut _);
  if !IsWindow(parent).as_bool(){let _=ShowWindow(hwnd,SW_HIDE);return Err("工作台设置区域已关闭".into())}
  let style=GetWindowLongPtrW(hwnd,GWL_STYLE) as u32;
  let next=(style&!(WS_POPUP.0|WS_CAPTION.0|WS_THICKFRAME.0|WS_MINIMIZEBOX.0|WS_MAXIMIZEBOX.0|WS_SYSMENU.0))|WS_CHILD.0|WS_CLIPCHILDREN.0|WS_CLIPSIBLINGS.0;
  if style!=next{SetWindowLongPtrW(hwnd,GWL_STYLE,next as isize);}
  if GetParent(hwnd).ok()!=Some(parent){let _=SetParent(hwnd,parent);if GetParent(hwnd).ok()!=Some(parent){return Err("无法将设置视图归入工作台".into())}}
  let mut bounds=RECT::default();GetWindowRect(hwnd,&mut bounds).map_err(|e|e.to_string())?;
  let mut pt=windows::Win32::Foundation::POINT{x:h.x,y:h.y};let _=windows::Win32::Graphics::Gdi::ClientToScreen(parent,&mut pt);
  let resize=bounds.left!=pt.x||bounds.top!=pt.y||bounds.right-bounds.left!=h.width||bounds.bottom-bounds.top!=h.height;
  let is_visible=IsWindowVisible(hwnd).as_bool();
  if resize||is_visible!=h.visible{
   let flags=SWP_NOACTIVATE|SWP_NOZORDER|SWP_FRAMECHANGED|if h.visible{SWP_SHOWWINDOW}else{SWP_HIDEWINDOW};
   SetWindowPos(hwnd,None,h.x,h.y,h.width.max(1),h.height.max(1),flags).map_err(|e|e.to_string())?;
  }
  let status=serde_json::json!({"type":"settings-host-status","attached":true,"section":section,"visible":h.visible,"handle":hwnd.0 as usize,"parent":parent_value,"width":h.width,"height":h.height}).to_string();
  let mut last=LAST.get_or_init(||Mutex::new(String::new())).lock().unwrap_or_else(|e|e.into_inner());
  if *last!=status{use std::io::Write;let _=writeln!(std::io::stdout().lock(),"{status}");*last=status;}
 }
 Ok(())
}
#[cfg(not(windows))]
pub fn apply(section:usize)->Result<(),String>{Err("本机尚不支持原生设置宿主".into())}
