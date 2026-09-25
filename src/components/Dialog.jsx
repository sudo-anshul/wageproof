import React,{useEffect,useId,useRef} from 'react';
import Icon from './Icon.jsx';
import './dialogs.css';
export default function Dialog({title,onClose,children,wide=false,className=''}){
 const ref=useRef(null);const titleId=useId();const closeRef=useRef(onClose);closeRef.current=onClose;
 useEffect(()=>{const d=ref.current;const previousFocus=document.activeElement;d.showModal();d.querySelector('[data-autofocus]')?.focus({preventScroll:true});const close=event=>{event.preventDefault();closeRef.current()};d.addEventListener('cancel',close);return()=>{d.removeEventListener('cancel',close);d.close();queueMicrotask(()=>{if(!d.open&&previousFocus?.isConnected)previousFocus.focus({preventScroll:true})})}},[]);
 return <dialog ref={ref} className={`dialog ${wide?'dialog-wide':''} ${className}`} aria-labelledby={titleId} onClick={e=>{if(e.target!==e.currentTarget)return;const box=e.currentTarget.getBoundingClientRect();if(e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom)onClose()}}><div className="dialog-inner"><header className="dialog-header"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><Icon name="close"/></button></header>{children}</div></dialog>
}
