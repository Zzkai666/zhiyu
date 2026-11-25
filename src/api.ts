export type Rect = { x: number; y: number; w: number; h: number };
export type PaperMetadata={arxiv:string;url:string;pdf:string;journal:string;abstract:string;keywords:string;source:string;status:string;updatedAt:string;error?:string};
export type Paper = {
  id: string; title: string; authors: string; year: number;
  status: '待阅读' | '阅读中' | '已读'; favorite: boolean; tags: string[];
  doi: string; addedAt: string; bytes: number; revision: number;
  deleted: boolean; page: number; zoom: number; readAt: string; totalPages?:number;remark?:string;remarkRevision?:number; metadata?:PaperMetadata;filename?:string;
};
export type Mark = { id: string; page: number; kind: 'bookmark' | 'highlight' | 'underline' | 'note' | 'text' | 'area' | 'ink'; color: 'amber' | 'red' | 'green' | 'blue' | 'purple' | 'pink' | 'orange' | 'gray'; quote: string; rects: Rect[]; comment?: string;content?:string;points?:{x:number;y:number}[];size?:number;width?:number;revision?:number };
export type Note = { id: string; title: string; body: string; paperId: string; page: number; quote: string; updatedAt: string; revision: number; deleted: boolean };
export type Word = { id: string; term: string; meaning: string; paperId: string; page: number; quote: string; dueAt: string; interval: number; revision: number };
export type Block = { kind: 'text' | 'title' | 'caption' | 'figure' | 'table' | 'formula'; rect: Rect; text: string; uncertain?: boolean };
export type Detection = { kind: string; score: number; rect: Rect };
export type Engine = 'native' | 'layout-v2';
export type Selection = { text: string; rects: Rect[] };

declare global {
  interface Window {
    desktop: {
      islandWeb(action:string,body?:unknown):Promise<any>;
      islandRestart():Promise<import('./Companion').IslandStatus>;
      islandStatus():Promise<import('./Companion').IslandStatus>;
      islandSettings(next:{enabled:boolean;keepRunning:boolean}):Promise<import('./Companion').IslandStatus>;
      islandAppearance():Promise<void>;
      onPlannerChanged(callback:()=>void):()=>void;
      onWorkspaceAction(callback:(action:import('./Companion').WorkspaceAction)=>void):()=>void;
      workspaceActionResult(result:{id:string;error?:string}):void;
      openExternal(url:string):Promise<void>;
      preparePaperExport(id:string):Promise<import('./PaperExport').PreparedExport>;
      releasePaperExport(id:string):Promise<void>;
      exportPaper(input:{id:string;format:'pdf'|'docx'|'markdown'|'annotated-pdf';includeUntranslated:boolean;assets:{id:string;png:string}[]}):Promise<{canceled:boolean;path?:string;bytes?:number}>;
      openPaperExport(id:string,folder:boolean):Promise<void>;
      importPDF(): Promise<Array<{ filename: string; paper?: Paper; duplicate?: boolean; error?: string }>>;
      savePNG(filename:string,url:string):Promise<boolean>;
      saveMarkdown(filename: string, content: string): Promise<boolean>;
      workspaceInfo():Promise<{directory:string}>;
      paperJobsActive(active:boolean):Promise<void>;
      openBuddyLogin():Promise<void>;
      chooseCodex():Promise<string|null>;
      openWorkspaceFolder():Promise<boolean>;
      layoutReady(): Promise<boolean>;
      detectLayout(pixels: Uint8Array): Promise<Detection[]>;
    };
  }
}

export class APIError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function api<T>(path: string, method = 'GET', payload?: unknown, signal?:AbortSignal): Promise<T> {
  const response = await fetch('/api' + path, {
    method, signal,
    ...(payload === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  });
  const data = await response.json();
  if (!response.ok) throw new APIError(response.status, data.error || '操作未完成');
  return data as T;
}

export async function updatePaper(p: Paper, patch: Partial<Paper>) {
  const { title, authors, year, status, favorite, tags, doi, revision, deleted } = { ...p, ...patch };
  return api<Paper>('/papers/' + p.id, 'PATCH', { title, authors, year, status, favorite, tags, doi, revision, deleted });
}

export function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
