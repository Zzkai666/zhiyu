export function sentenceBounds(text:string):Array<{start:number;end:number}>{
  const segments=Array.from(new Intl.Segmenter('en',{granularity:'sentence'}).segment(text),part=>({start:part.index,end:part.index+part.segment.length}));
  const output:Array<{start:number;end:number}>=[];
  for(const segment of segments){
    const previous=output.at(-1);
    if(previous&&/\b(?:figs?|eqs?|refs?|dr|prof|mr|mrs|ms|vs|al|e\.g|i\.e)\.\s*$/i.test(text.slice(previous.start,previous.end)))previous.end=segment.end;
    else output.push({...segment});
  }
  return output;
}
