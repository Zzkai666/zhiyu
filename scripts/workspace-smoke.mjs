import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const output=resolve(process.env.RDNEXT_WORKSPACE_RESULTS||'test-results/workspace-0.3.0');
await mkdir(output,{recursive:true});
const root=await mkdtemp(join(output,'isolated-workspace-'));
const workspace=join(root,'workspace');
const sample=resolve(process.env.RDNEXT_SAMPLE||'test-results/reader-0.2.1/2510.07077v1.pdf');
const exe=process.env.RDNEXT_EXE;
let app,page;
const errors=[];
async function launch(){
  app=await electron.launch({args:[...(exe?[]:['.']),'--workspace='+workspace],...(exe?{executablePath:exe}:{})});
  page=await app.firstWindow();
  page.on('pageerror',error=>errors.push(error.message));
  await page.getByRole('heading',{name:'今日工作台'}).waitFor();
}
const button=(name,container=page)=>container.getByRole('button',{name,exact:true});
const nav=name=>button(name,page.getByRole('navigation')).click();
async function call(path,method='GET',body){
  return page.evaluate(async({path,method,body})=>{
    const response=await fetch('/api'+path,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
    const json=await response.json();
    if(!response.ok)throw Error(method+' '+path+' '+response.status+' '+JSON.stringify(json));
    return json;
  },{path,method,body});
}
try{
  await launch();
  assert.equal(await page.getByRole('navigation').getByRole('button').count(),9);
  await page.getByRole('textbox',{name:'快速添加任务'}).fill('快速记录 · 对照复现实验');
  await page.getByRole('textbox',{name:'快速添加任务'}).press('Enter');
  await page.getByText('快速记录 · 对照复现实验',{exact:true}).waitFor();
  assert.equal((await call('/agenda')).length,1);
  await nav('任务日程');
  await button('周').click();
  await button('下一周').click();
  await button('上一周').click();
  await page.getByText('快速记录 · 对照复现实验',{exact:true}).waitFor();
  await page.getByLabel('完成状态').selectOption('done');
  await page.getByText('此处没有安排',{exact:true}).waitFor();
  await page.getByLabel('完成状态').selectOption('all');
  await page.screenshot({path:join(output,'agenda.png')});

  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]})},sample);
  await nav('文献库');
  await button('导入 PDF').click();
  await button('选择 PDF 文件').click();
  await button('完成').click();
  await button('待读').click();
  const paper=(await call('/papers'))[0];
  assert.ok(paper);
  await page.getByText(paper.title,{exact:true}).waitFor();

  await nav('笔记中心');
  await button('新建笔记').click();
  let dialog=page.getByRole('dialog');
  await dialog.getByLabel('标题',{exact:true}).fill('实验对照备忘');
  await dialog.getByLabel('笔记内容').fill('跨论文对照时先检查基准数据。');
  await button('保存笔记',dialog).click();
  await page.getByText('实验对照备忘',{exact:true}).waitFor();
  await page.getByLabel('笔记来源').selectOption('paper');
  await page.getByText('没有匹配的笔记',{exact:true}).waitFor();
  await page.getByLabel('笔记来源').selectOption('independent');

  await nav('目标与项目');
  await button('新建项目').click();
  dialog=page.getByRole('dialog');
  await dialog.getByLabel('项目名称').fill('机械臂复现');
  await dialog.getByLabel('领域').selectOption('research');
  await button('保存项目',dialog).click();
  await page.getByRole('heading',{name:'机械臂复现',exact:true}).waitFor();
  const project=(await call('/projects'))[0];
  await button('关联文献').click();
  await button(paper.title,page.getByRole('dialog')).click();
  await button(paper.title,page.getByLabel('项目详情')).waitFor();
  await button('关联笔记').click();
  await button('实验对照备忘',page.getByRole('dialog')).click();
  await button('实验对照备忘',page.getByLabel('项目详情')).waitFor();
  assert.equal((await call('/projects/'+project.id+'/materials')).length,2);
  await button('目标').click();
  await button('新建目标').click();
  dialog=page.getByRole('dialog');
  await dialog.getByLabel('目标名称').fill('核对结果表');
  await dialog.getByLabel('衡量方式').selectOption('numeric');
  await dialog.getByLabel('目标值').fill('4');
  await dialog.getByLabel('单位',{exact:true}).fill('篇');
  await dialog.getByRole('checkbox',{name:'机械臂复现'}).check();
  await button('保存目标',dialog).click();
  await page.getByRole('heading',{name:'核对结果表',exact:true}).waitFor();
  await button('更新进展').click();
  dialog=page.getByRole('dialog');
  await dialog.getByLabel('当前值').fill('6');
  await dialog.getByLabel('进展依据').fill('核对六份已保存的结果表');
  await button('保存目标',dialog).click();
  await page.getByText('150%',{exact:true}).waitFor();
  assert.equal(await page.getByRole('progressbar',{name:'目标进展'}).getAttribute('value'),'100');
  await button('查看记录').click();
  await page.getByText('核对六份已保存的结果表',{exact:true}).waitFor();
  await page.screenshot({path:join(output,'goal.png')});
  await button('机械臂复现',page.getByLabel('目标详情')).click();
  await button('核对结果表',page.getByLabel('项目详情')).waitFor();
  await page.screenshot({path:join(output,'project.png')});

  await nav('生词与复习');
  await button('收录生词').click();
  dialog=page.getByRole('dialog');
  await dialog.getByLabel('词条').fill('ablation');
  await dialog.getByLabel('释义').fill('消融实验');
  await button('保存生词',dialog).click();
  await page.getByRole('heading',{name:'ablation',exact:true}).waitFor();
  await nav('今日工作台');
  await page.getByRole('button',{name:/1 个词到期/}).click();
  const card=page.getByLabel('生词复习卡');
  await card.press('Space');
  await card.getByText('消融实验',{exact:true}).waitFor();
  await page.screenshot({path:join(output,'review.png')});
  await card.press('2');
  await card.getByText('今天没有到期词条',{exact:true}).waitFor();

  await nav('课程学习');
  await button('新建课程').click();
  dialog=page.getByRole('dialog');
  await dialog.getByLabel('课程名称').fill('机器人学');
  await button('保存',dialog).click();
  await button('添加章节').click();
  dialog=page.getByRole('dialog');
  await dialog.getByLabel('章节名称').fill('策略评估');
  await dialog.getByLabel('关联 PDF').selectOption(paper.id);
  await button('保存',dialog).click();
  await button('标记学完').click();
  await button('重新开始学习').waitFor();
  assert.equal(await page.getByRole('progressbar',{name:'课程章节完成进度'}).getAttribute('value'),'1');
  await page.screenshot({path:join(output,'course.png')});

  await nav('运动与生活');
  await button('记一瓶').click();
  await page.getByText('1 / 4 瓶',{exact:true}).waitFor();
  await button('新建记录').click();
  dialog=page.getByRole('dialog');
  await dialog.getByLabel('记录名称').fill('校园慢跑');
  await dialog.getByLabel('时长（分钟）').fill('35');
  await button('保存记录',dialog).click();
  const week=page.getByLabel('本周运动概况');
  await week.getByText('35',{exact:true}).waitFor();
  await button('再记一次 校园慢跑',week).click();
  dialog=page.getByRole('dialog');
  assert.equal(await dialog.getByLabel('记录名称').inputValue(),'校园慢跑');
  assert.equal(await dialog.getByLabel('时长（分钟）').inputValue(),'');
  await button('关闭对话框',dialog).click();
  await page.screenshot({path:join(output,'life.png')});

  await nav('实验记录');
  await button('新建实验').click();
  dialog=page.getByRole('dialog');
  await dialog.getByLabel('实验名称').fill('控制策略对照');
  await dialog.getByLabel('关联项目').selectOption(project.id);
  await button('保存',dialog).click();
  const experiment=(await call('/experiments'))[0];
  const date=await page.evaluate(()=>new Date().toLocaleDateString('sv-SE'));
  for(const [title,value] of [['基线运行',0.7],['新运行',0.85]])
    await call('/experiments/'+experiment.id+'/runs','POST',{id:'',experimentId:experiment.id,title,day:date,
      status:'finished',condition:'相同种子和任务',metrics:[{name:'成功率',value,unit:'比例'}],revision:0});
  await nav('今日工作台');await nav('实验记录');
  await button('复用运行条件 基线运行').click();
  dialog=page.getByRole('dialog');
  assert.equal(await dialog.getByLabel('运行条件').inputValue(),'相同种子和任务');
  assert.equal(await dialog.getByLabel('数值',{exact:true}).inputValue(),'');
  await button('关闭对话框',dialog).click();
  await page.getByRole('checkbox',{name:'对比 基线运行'}).check();
  await page.getByRole('checkbox',{name:'对比 新运行'}).check();
  await button('比较 2 次运行').click();
  dialog=page.getByRole('dialog');
  await dialog.getByLabel('对比基线').selectOption({label:'基线运行'});
  await dialog.getByText('+0.15',{exact:true}).waitFor();
  await page.screenshot({path:join(output,'experiment.png')});
  await button('关闭对话框',dialog).click();

  await app.close();app=undefined;await launch();
  await nav('目标与项目');
  await page.getByRole('heading',{name:'机械臂复现',exact:true}).waitFor();
  await button('实验对照备忘',page.getByLabel('项目详情')).waitFor();
  await button('核对结果表',page.getByLabel('项目详情')).click();
  await page.getByText('150%',{exact:true}).waitFor();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(900,700));
  assert.equal(await page.evaluate(()=>document.querySelector('main').scrollWidth>document.querySelector('main').clientWidth+1),false);
  await page.screenshot({path:join(output,'narrow-goal.png')});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({root,navigation:9,quickTasks:1,projectMaterials:2,goalProgress:150,chaptersDone:1,dueWords:0,weeklyMinutes:35,baselineDifference:.15,reopened:true}));
}catch(error){
  if(page)await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});
  throw error;
}finally{if(app)await app.close()}
