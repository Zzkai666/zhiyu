import type {Rect} from './api';
export function focusZoom(rect:Rect,view:{width:number;height:number;base:number;aspect:number;zoom:number}){
 const fit=Math.min((view.width-48)/(rect.w*view.base),(view.height-64)/(rect.h*view.base*view.aspect))*100;
 return Math.max(20,Math.min(view.zoom,Math.floor(fit)));
}
