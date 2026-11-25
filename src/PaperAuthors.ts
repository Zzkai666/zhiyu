const visibleCount = 3;
const word = /^[\p{Script=Latin}\p{M}.’'\-]+$/u;

function commaNames(parts: string[]): string[] | undefined {
  if (parts.length < 2) return parts;

  // Typical comma-separated full names, including lists of unspaced CJK names.
  const completeName = (part: string) => /\s/u.test(part) || /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(part);
  if (parts.every(completeName)) return parts;

  // Older imported metadata can flatten "Family, Given" pairs into one string.
  // Only count pairs when the pattern repeats and the individual fields fit a name.
  const singleFamilyNames = parts.filter((part,index) => index%2===0 && word.test(part)).length;
  if (parts.length>=8 && parts.length%2===0 && singleFamilyNames>=parts.length/3 &&
      parts.every(part => {
        const tokens=part.split(/\s+/u);
        return tokens.length<=3 && tokens.every(token=>word.test(token));
      })) {
    return parts.filter((_,index)=>index%2===0).map((part,index)=>part+', '+parts[index*2+1]);
  }
  return undefined;
}

export function summarizeAuthors(authors: string) {
  const full=authors.trim()||'作者待补充';
  const trim=(entries: string[])=>entries.map(entry=>entry.trim()).filter(Boolean);
  const explicit=trim(full.split(/[;；、\n]+/u));
  const parts=trim(full.split(/[,，]+/u));
  const names=explicit.length>1?explicit:commaNames(parts);

  if (names && names.length>visibleCount) {
    return {full,preview:names.slice(0,visibleCount).join('；'),remaining:names.length-visibleCount,expandable:true,clamp:false};
  }
  const clamp=full.length>100 || (!names&&parts.length>visibleCount);
  return {full,preview:full,remaining:0,expandable:clamp,clamp};
}