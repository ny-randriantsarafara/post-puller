import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PreviewPage } from './PreviewPage';
import './preview.css';

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error('Preview root element was not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <PreviewPage />
  </StrictMode>,
);
