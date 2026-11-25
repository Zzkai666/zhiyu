export type Project = { id:string; title:string; description:string; status:'active'|'done'|'archived'; area:string; deadline:string; revision:number };
export type AgendaItem = {
  id:string; kind:'task'|'event'; title:string; detail:string; day:string; start:string; end:string;
  important:boolean; milestone:''|'exam'|'deadline'|'other'; repeat:'none'|'daily'|'weekly'; repeatDays:number; repeatUntil:string; paused:boolean;
  deadline:string; projectId:string; paperId:string; paperPage:number; done:boolean; deleted:boolean; revision:number;
};

export const freshAgenda: AgendaItem = { important:false,milestone:'',repeat:'none',repeatDays:0,repeatUntil:'',paused:false,id:'',kind:'task',title:'',detail:'',day:'',start:'',end:'',deadline:'',projectId:'',paperId:'',paperPage:0,done:false,deleted:false,revision:0 };

function localISO(d: Date) {
  return [String(d.getFullYear()).padStart(4,'0'),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
}
export function today() { return localISO(new Date()); }
