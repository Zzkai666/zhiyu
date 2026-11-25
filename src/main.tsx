import { createRoot } from 'react-dom/client';
import { App } from './App';
import {initWorkbenchAppearance} from './WorkbenchSettings';
import './style.css';
import './workbench.css';
import './library-workflow.css';
import './journal-detail.css';
import './brand.css';

initWorkbenchAppearance();
createRoot(document.getElementById('root')!).render(<App />);
