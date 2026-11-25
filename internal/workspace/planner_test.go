package workspace
import("testing";"encoding/json";"context";"net/http";"path/filepath";"database/sql";"os")
func plannerFixture(t *testing.T,w *Workspace,a Agenda) Agenda {t.Helper(); if a.Kind==""{a.Kind="task"};raw:=sendJSON(t,w.Handler(testHost,testToken),"POST","/agenda",a,201);var out Agenda;json.Unmarshal(*raw,&out);return out}
func plannerDo(t *testing.T,w *Workspace,a PlannerItem,action string,status int,requestID string) PlannerItem{t.Helper();if requestID==""{requestID=newID()};raw:=sendJSON(t,w.Handler(testHost,testToken),"POST","/planner/action",PlannerAction{RequestID:requestID,ID:a.ID,SeriesID:a.SeriesID,Day:a.OccurrenceDay,Revision:a.Revision,SeriesRevision:a.SeriesRevision,Action:action},status);var out PlannerItem;json.Unmarshal(*raw,&out);return out}
func board(t *testing.T,w *Workspace,day string)PlannerBoard{t.Helper();b,e:=w.readPlanner(context.Background(),day);if e!=nil{t.Fatal(e)};return b}
func TestPlannerImportantDatesIgnoreViewedDate(t *testing.T){w,e:=Open(t.TempDir());if e!=nil{t.Fatal(e)};defer w.Close()
 a:=plannerFixture(t,w,Agenda{Title:"明年考试",Day:"2027-06-01",Important:true,Milestone:"exam"})
 plannerFixture(t,w,Agenda{Title:"旧截止",Deadline:"2026-11-14"})
 plannerFixture(t,w,Agenda{Title:"今日安排",Day:"2026-11-13"})
 for _,day:=range []string{"2026-11-13","2028-01-01"}{b:=board(t,w,day);if len(b.Important)!=2{t.Fatal(b)}}
 plannerDo(t,w,PlannerItem{Agenda:a},"complete",200,"");if len(board(t,w,"2026-11-13").Important)!=1{t.Fatal("completed important remains")}
}
func TestPlannerDailyOccurrencesIndependentReadOnlyAndIdempotent(t *testing.T){w,e:=Open(t.TempDir());if e!=nil{t.Fatal(e)};defer w.Close()
 a:=plannerFixture(t,w,Agenda{Title:"背单词",Day:"2026-11-01",Repeat:"daily"});b:=board(t,w,"2026-11-13");if len(b.Today)!=1||len(b.Overdue)!=0{t.Fatal(b)}
 for i:=0;i<5;i++{board(t,w,"2027-01-01")};var count int;w.db.QueryRow("SELECT count(*) FROM agenda_occurrences").Scan(&count);if count!=0{t.Fatal("GET created occurrence")}
 ticket:=newID();done:=plannerDo(t,w,b.Today[0],"complete",200,ticket);again:=plannerDo(t,w,b.Today[0],"complete",200,ticket);if !done.Done||done.Revision!=again.Revision{t.Fatal(done,again)}
 plannerDo(t,w,b.Today[0],"reopen",409,"");if board(t,w,"2026-11-14").Today[0].Done{t.Fatal("completion leaked to next day")}
 skipped:=plannerDo(t,w,done,"skip",200,"");if len(board(t,w,"2026-11-13").Skipped)!=1{t.Fatal("skip missing")}
 restored:=plannerDo(t,w,skipped,"restore",200,"");plannerDo(t,w,restored,"reopen",200,"")
 a.Paused=true;raw:=sendJSON(t,w.Handler(testHost,testToken),"PATCH","/agenda/"+a.ID,a,200);json.Unmarshal(*raw,&a)
 if len(board(t,w,"2026-11-14").Today)!=0||len(board(t,w,"2026-11-13").Today)!=1{t.Fatal("pause lost history or created future")}
 plannerDo(t,w,restored,"complete",409,"")
 a.Repeat="none";a.Paused=false;sendJSON(t,w.Handler(testHost,testToken),"PATCH","/agenda/"+a.ID,a,409)
}
func TestPlannerWeeklyBoundsAndInvalidCommands(t *testing.T){w,e:=Open(t.TempDir());if e!=nil{t.Fatal(e)};defer w.Close()
 a:=plannerFixture(t,w,Agenda{Title:"每周五",Day:"2026-12-25",Repeat:"weekly",RepeatDays:16,RepeatUntil:"2027-01-08"})
 for _,day:=range []string{"2026-12-25","2027-01-01","2027-01-08"}{if len(board(t,w,day).Today)!=1{t.Fatal(day)}}
 for _,day:=range []string{"2026-12-18","2026-12-26","2027-01-15"}{if len(board(t,w,day).Today)!=0{t.Fatal(day)}}
 fake:=deriveItem(a,"2026-12-26",occurrence{});plannerDo(t,w,fake,"complete",409,"")
 fake=deriveItem(a,"2027-01-01",occurrence{});fake.ID=newID();plannerDo(t,w,fake,"complete",400,"")
 sendJSON(t,w.Handler(testHost,testToken),"POST","/agenda",Agenda{Kind:"task",Title:"bad",Repeat:"weekly",Day:"2026-11-13"},400)
 r:=request(t,w.Handler(testHost,testToken),http.MethodGet,"/planner?day=2026-02-30","",nil);if r.Code!=400{t.Fatal(r.Code)}
}
func TestPlannerMovePreservesObjectAndSource(t *testing.T){w,e:=Open(t.TempDir());if e!=nil{t.Fatal(e)};defer w.Close();a:=taskFixture(t,w)
 in:=PlannerAction{RequestID:newID(),ID:a.ID,Revision:a.Revision,Day:"2026-11-14",Action:"move"}
 raw:=sendJSON(t,w.Handler(testHost,testToken),"POST","/planner/action",in,200);var moved PlannerItem;json.Unmarshal(*raw,&moved)
 if moved.Day!=in.Day||moved.ID!=a.ID||moved.PaperID!=a.PaperID{t.Fatal(moved)}
 important:=plannerFixture(t,w,Agenda{Title:"考试",Day:"2027-01-01",Important:true,Milestone:"exam"});in.RequestID=newID();in.ID=important.ID;in.Revision=important.Revision;sendJSON(t,w.Handler(testHost,testToken),"POST","/planner/action",in,400)
}
func TestPlannerSchema9BackupAndUpgrade(t *testing.T){dir:=t.TempDir();db,e:=sql.Open("sqlite",filepath.Join(dir,"researchdesk-next.sqlite"));if e!=nil{t.Fatal(e)}
 for _,s:=range []string{schema,schema2,schema3,schema4,schema5,schema6,schema7,schema8,schema9}{if _,e=db.Exec(s);e!=nil{t.Fatal(e)}};db.Close()
 w,e:=Open(dir);if e!=nil{t.Fatal(e)};w.Close();files,_:=filepath.Glob(filepath.Join(dir,"pre-schema*-*.sqlite"));if len(files)==0{entries,_:=os.ReadDir(filepath.Join(dir,"backups"));t.Fatal("missing backup",entries)}
}
