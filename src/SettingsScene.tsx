import{CalendarDays,Bell,Music2,Sun,Layers,Timer,Mail,Monitor}from'lucide-react';
import{DeskArt}from'./Journal';
type SceneData={water?:{goal:number};mail?:{accounts:unknown[]};calendar?:{accounts:unknown[]};quota?:{accounts:any[]};weather?:{city:string};desktop?:{enabled:boolean}};
export function SettingsScene({category,values,desktop,data}:{category:string;values:Record<string,string>;desktop?:{installed?:boolean;ready?:boolean;enabled?:boolean};data?:SceneData}){
 const skins:Record<string,string>={classic:'经典黑',cream:'奶油',glass_light:'毛玻璃·浅',glass:'毛玻璃·深',fluid:'悬浮云'};
 const skin=values.skin||'glass_light',minutes=Number(values.focus_minutes||25),delay=values.lyric_delay_ms||'0';const count=values.visible_pages?.split('').filter(v=>v==='1').length;
 const pageNames=['音乐与歌词','专注','饮水','置物架','待办','邮箱','AI 额度','日历','天气'];
 const orderedPages=(values.page_order||'0,1,2,3,4,5,6,7,8').split(',').map(Number).filter(i=>Number.isInteger(i)&&pageNames[i]&&values.visible_pages?.[i]==='1');
 const title=category==='health'?String(minutes).padStart(2,'0')+':00':category==='music'?'音乐与歌词':category==='notifications'?'通知摘要':category==='mail'?'邮箱提醒':category==='calendar'?'日历日程':category==='quota'?'账号额度':category==='weather'?'天气':category==='pages'?'常驻组件':'桌面小岛';
 const Icon=category==='health'?Timer:category==='music'?Music2:category==='notifications'?Bell:category==='mail'?Mail:category==='calendar'?CalendarDays:category==='quota'?Layers:category==='weather'?Sun:Monitor;
 return <aside className="settings-scene" aria-label="小岛设置预览"><small>小岛预览 · 保存后应用到桌面</small><div className="island-live-widget" data-skin={skin} data-shape={values.island_shape||'notch'}><Icon className="preview-glyph" size={27}/><div><strong>{title}</strong><span>{category==='general'?(desktop?.installed===false?'未安装 · 可选组件':desktop?.ready?'组件已连接':'与工作台一起使用'):category==='appearance'?(skins[skin]||'原主题')+' · '+(values.island_size||100)+'%':category==='notifications'?(values.notification_preview==='1'?'显示摘要内容':'正文已隐藏'):category==='pages'?(count===undefined?'调整组件顺序':count+' 个页面已开启'):'效果示意'}</span></div></div>
 {['appearance','general'].includes(category)&&<><h3>放在顺手的位置</h3><p>工作台负责资料与安排，小岛负责桌面上的轻量接续。</p><div className="preview-monitor" data-dock={values.dock||'top'}><i className="preview-position"/></div></>}
 {category==='pages'&&<><h3>常用的，留在岛上</h3><div className="preview-lines">{orderedPages.slice(0,4).map((i,n)=><span key={i}>{pageNames[i]}<b>{n+1}</b></span>)}</div><p>拖动列表调整顺序，也可以使用上下移动按钮。</p></>}
 {category==='music'&&<><h3>歌词时间调整</h3><div className="preview-delay">{Number(delay)>0?'+':''}{delay} <small>毫秒</small></div><p>负数提前显示，正数延后显示。收起时的歌词沿用原有样式。</p></>}
 {category==='health'&&<><h3>照顾好节奏</h3><div className="preview-lines"><span>专注 <b>{minutes} 分钟</b></span><span>休息 <b>{values.rest_minutes||5} 分钟</b></span><span>饮水间隔 <b>{values.water_minutes||45} 分钟</b></span><span>提醒时段 <b>{values.water_start||9}:00 — {values.water_end||22}:00</b></span>{data?.water&&<span>每日饮水目标 <b>{data.water.goal} ml</b></span>}</div><p>午休与提醒开关按左侧设置生效。</p></>}
 {category==='notifications'&&<><h3>只让重要的消息打断你</h3><p>预览不读取真实消息。正文显示、声音和应用开关都可以单独调整。</p></>}
 {category==='mail'&&<><h3>邮箱放在一处</h3><p>已保存 {data?.mail?.accounts.length||0} 个邮箱账号。授权码通过本机账号服务保管。</p><div className="preview-lines"><span>检查间隔 <b>{values.mail_interval||120} 秒</b></span><span>验证码提示 <b>{values.mail_code==='1'?'开启':'关闭'}</b></span></div></>}
 {category==='calendar'&&<><h3>重要约定，不用反复找</h3><p>已保存 {data?.calendar?.accounts.length||0} 个外部日历连接。任务日程仍可以独立记录。</p></>}
 {category==='quota'&&<><h3>以实际返回额度为准</h3>{data?.quota?.accounts.length?data.quota.accounts.slice(0,3).map((a:any)=><div className="preview-lines" key={a.id}><span>{a.alias||a.provider}<b>{a.balance||'已连接'}</b></span></div>):<p>连接已有账号后，在小岛查看剩余额度；本机账号发现由你主动触发。</p>}</>}
 {category==='weather'&&<><h3>抬头看看，今天的天气</h3><p>{data?.weather?.city||'按当前设置选择城市'}。天气会在小岛中自动更新。</p></>}
 <DeskArt kind={category==='health'?'life':category==='calendar'?'calendar':category==='pages'?'project':category==='music'?'music':category==='weather'?'weather':'settings'}/></aside>
}
