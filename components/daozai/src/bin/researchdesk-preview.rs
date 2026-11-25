//! Isolated software-rendered acceptance of the real egui research page and inherited pipe.
include!("navigation-preview.inc.rs");
#[path="daozai-record/raster.rs"] mod raster;
use daozai::app::{App,Env,Options};
use eframe::egui::{self,Pos2,Rect,Vec2,Event,PointerButton,Modifiers};
use std::{path::PathBuf,time::Duration};
fn text_pos(shape:&egui::Shape,label:&str)->Option<Pos2>{
 match shape{egui::Shape::Text(t) if t.galley.job.text==label=>Some(t.pos+t.galley.size()/2.0),
 egui::Shape::Vec(items)=>items.iter().find_map(|s|text_pos(s,label)),_=>None}
}
fn frame(ctx:&egui::Context,app:&mut App,raster:&mut raster::Raster,t:f64,events:Vec<Event>,cursor:Pos2)->egui::FullOutput{
 let rect=Rect::from_min_size(Pos2::ZERO,Vec2::new(960.0,270.0));
 let input=egui::RawInput{screen_rect:Some(rect),time:Some(t),events,..Default::default()};
 let env=Env{t,clock:"11:30:00".into(),date:"11月13日 周五".into(),today:"2026-11-13".into(),cursor:Some(cursor),screen:Some(rect),backdrop:Some([0.76,0.82,0.9]),glass_blur:true,..Default::default()};
 let out=ctx.run(input,|ctx|{egui::CentralPanel::default().frame(egui::Frame::NONE).show(ctx,|ui|{app.frame(ui,rect,&env);});});
 raster.update_textures(&out.textures_delta);
 raster.buf.fill([0.83,0.88,0.94,1.0]);
 let primitives=ctx.tessellate(out.shapes.clone(),out.pixels_per_point);raster.draw(&primitives,out.pixels_per_point);raster.free_textures(&out.textures_delta);out
}
fn save(r:&raster::Raster,path:PathBuf){let mut rgba=vec![];r.to_rgba8(&mut rgba);image::RgbaImage::from_raw(r.w as u32,r.h as u32,rgba).unwrap().save(path).unwrap();}
fn main(){
 let output=PathBuf::from(std::env::args().nth(1).expect("Output directory required"));
 std::fs::create_dir_all(&output).unwrap();
 let ctx=egui::Context::default();ctx.set_pixels_per_point(2.0);
 daozai::companion::start(ctx.clone());
 for _ in 0..100{if !daozai::companion::read().snapshot.is_null(){break}std::thread::sleep(Duration::from_millis(30))}
 assert!(!daozai::companion::read().snapshot.is_null(),"No pipe snapshot");
 if std::env::args().any(|a|a=="--navigation"){navigation_preview(&ctx,&output);return;}
 let mut app=App::new(&ctx,Options{fetch_lyrics:false,pet_idle:9999.0});
 app.show_page(4);
 let mut raster=raster::Raster::new(1920,540);let mut t=0.0;
 let cursor=Pos2::new(320.0,70.0);let mut out=None;
 for _ in 0..120{t+=1.0/60.0;out=Some(frame(&ctx,&mut app,&mut raster,t,vec![Event::PointerMoved(cursor)],cursor));}
 save(&raster,output.join("research-glass-light.png"));
 for (label,name) in [("继续阅读","after-read-click.png"),("专注","research-focus-glass-light.png")]{
  let point=out.as_ref().unwrap().shapes.iter().find_map(|s|text_pos(&s.shape,label)).unwrap_or_else(||panic!("Button not drawn: {label}"));
  for pressed in [true,false]{t+=1.0/60.0;out=Some(frame(&ctx,&mut app,&mut raster,t,vec![Event::PointerMoved(point),Event::PointerButton{pos:point,button:PointerButton::Primary,pressed,modifiers:Modifiers::NONE}],point));}
  for _ in 0..100{if !daozai::companion::read().busy{break}std::thread::sleep(Duration::from_millis(20))}
  for _ in 0..30{t+=1.0/60.0;out=Some(frame(&ctx,&mut app,&mut raster,t,vec![],point));}
  save(&raster,output.join(name));
 }
 assert!(daozai::companion::focus_progress().is_some(),"Native focus click did not produce an acknowledged snapshot");
 std::fs::write(output.join("render-summary.json"),r#"{"passed":true,"renderer":"upstream egui software rasterizer","mouse":"synthetic egui pointer input","nativeWindowLaunchVerifiedSeparately":true}"#).unwrap();
}
