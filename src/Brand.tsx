import icon from './assets/brand/azhi-icon.png';
import mascot from './assets/brand/azhi-mascot.png';
export function BrandIcon(){return <img className="azhi-brand-icon" src={icon} alt="" aria-hidden="true" draggable={false}/>;}
export function AzhiMascot({className=''}:{className?:string}){return <img className={'azhi-mascot '+className} src={mascot} alt="" aria-hidden="true" draggable={false}/>;}
