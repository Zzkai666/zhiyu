import { Fragment } from 'react';

// Unmapped Unicode script glyphs retain an explicit script in the stored text.
export function InlineMath({ text }: { text: string }) {
  const pieces = text.split(/([_^]\{[^{}\n]{1,30}\})/gu);
  return <>{pieces.map((piece,index) => /^[_^]\{[^{}]+\}$/u.test(piece) ?
    piece[0] === '_' ? <sub key={index}>{piece.slice(2,-1)}</sub> : <sup key={index}>{piece.slice(2,-1)}</sup> :
    <Fragment key={index}>{piece}</Fragment>)}</>;
}
