import type {Paper} from './api';
export function mergePaper(current:Paper,saved:Paper):Paper{
 const metadata=current.revision>saved.revision?current:saved;
 const position=current.readAt>saved.readAt?current:saved;
 const remark=(current.remarkRevision||0)>(saved.remarkRevision||0)?current:saved;
 return {...metadata,page:position.page,zoom:position.zoom,readAt:position.readAt,totalPages:saved.totalPages||current.totalPages||0,remark:remark.remark||'',remarkRevision:remark.remarkRevision||0};
}
