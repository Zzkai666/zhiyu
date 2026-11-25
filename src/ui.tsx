import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useRef, type ReactNode } from 'react';

export function Modal({ title, subtitle, close, children, wide, guardDraft, className }: { title: string; subtitle?: string; close: () => void; children: ReactNode; wide?: boolean; guardDraft?: boolean; className?:string }) {
  const dirty = useRef(false);
  return <Dialog.Root open onOpenChange={open => {
    if (!open && (!guardDraft || !dirty.current || window.confirm('放弃本次未保存的修改？'))) close();
  }}>
    <Dialog.Portal>
      <Dialog.Overlay className="modal-overlay"/>
      <Dialog.Content onInputCapture={() => { dirty.current = true; }} className={["modal",wide?"modal-wide":"",className].filter(Boolean).join(" ")}>
        <div className="modal-heading"><Dialog.Title>{title}</Dialog.Title>
          <Dialog.Close className="icon" aria-label="关闭对话框"><X size={18}/></Dialog.Close>
        </div>
        <Dialog.Description className={subtitle ? '' : 'sr-only'}>{subtitle || title}</Dialog.Description>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

export function Empty({ title, detail, children }: { title: string; detail?: string; children?: ReactNode }) {
  return <div className="empty"><span className="empty-line"/><h2>{title}</h2>{detail && <p>{detail}</p>}{children}</div>;
}
