export function reviewExcerpt(text:string,tail:boolean,limit=230) {
  const value=text.replace(/\s+/gu,' ').trim();
  if(value.length<=limit)return value;
  if(tail){
    let offset=value.length-limit;
    while(offset<value.length&&!/\s/u.test(value[offset-1]))offset++;
    return '…'+value.slice(offset);
  }
  let offset=limit;
  while(offset>0&&!/\s/u.test(value[offset]))offset--;
  return value.slice(0,offset||limit)+'…';
}
