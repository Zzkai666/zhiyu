fn nav_frames(ctx:&egui::Context,app:&mut App,raster:&mut raster::Raster,t:&mut f64,p:Pos2,n:usize){
 for _ in 0..n{*t+=1.0/60.0;frame(ctx,app,raster,*t,vec![Event::PointerMoved(p)],p);}
}
fn navigation_preview(ctx:&egui::Context,output:&std::path::Path){
 let mut app=App::new(ctx,Options{fetch_lyrics:false,pet_idle:9999.0});
 app.settings.visible_pages=[true,true,false,false,true,false,false,false,false];
 let mut raster=raster::Raster::new(1920,540);let mut t=0.0;
 let body=Pos2::new(480.0,150.0);
 let response=|id:&str|ctx.read_response(egui::Id::new(("card",true,id))).expect("Navigation target missing").rect;
 let mut checks=Vec::new();
 for (id,lower,expected) in [("nav-l",false,1),("nav-l",true,1),("nav-r",false,0),("nav-r",true,0)]{
  app.show_page(4);nav_frames(ctx,&mut app,&mut raster,&mut t,body,55);
  let rect=response(id);assert!((rect.width()-34.0).abs()<0.5);assert!((rect.height()-164.0).abs()<0.5);
  let p=Pos2::new(if id=="nav-l"{rect.left()+3.0}else{rect.right()-3.0},if lower{rect.bottom()-5.0}else{rect.top()+5.0});
  // Corners far from the arrow must click just like its center.
  nav_frames(ctx,&mut app,&mut raster,&mut t,p,3);
  for pressed in [true,false]{t+=1.0/60.0;frame(ctx,&mut app,&mut raster,t,vec![Event::PointerMoved(p),Event::PointerButton{pos:p,button:PointerButton::Primary,pressed,modifiers:Modifiers::NONE}],p);}
  assert_eq!(app.page(),expected,"Rail corner did not navigate");
  checks.push(format!("{id}: {} corner switches once and skips hidden pages",if lower{"lower"}else{"upper"}));
 }
 app.show_page(4);nav_frames(ctx,&mut app,&mut raster,&mut t,body,60);save(&raster,output.join("navigation-idle.png"));
 let rect=response("nav-r");let hover=rect.center();nav_frames(ctx,&mut app,&mut raster,&mut t,hover,15);save(&raster,output.join("navigation-hover.png"));
 assert!(response("nav-l").right()<310.5,"Left rail overlaps content");
 assert!(rect.left()>642.5,"Right rail overlaps content");
 checks.push("Todo rails are 34×164 logical points; content, header and footer stay outside".into());
 app.show_page(0);nav_frames(ctx,&mut app,&mut raster,&mut t,body,50);assert!((response("nav-r").height()-56.0).abs()<0.5);save(&raster,output.join("navigation-compact.png"));checks.push("Short panels use 34×56 targets".into());
 app.settings.visible_pages=[false,false,false,false,true,false,false,false,false];app.show_page(4);nav_frames(ctx,&mut app,&mut raster,&mut t,body,45);assert!(ctx.read_response(egui::Id::new(("card",true,"nav-l"))).is_none());checks.push("One visible page has no navigation targets".into());
 std::fs::write(output.join("render-summary.json"),serde_json::to_vec_pretty(&serde_json::json!({"passed":true,"renderer":"real egui software rasterizer","input":"synthetic egui pointer press/release","checks":checks})).unwrap()).unwrap();
}
