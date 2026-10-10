import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
// Стиль Mind (MindKit) — до index.css, чтобы утилиты Tailwind могли переопределять отступы кнопок
import "./styles/mind-ui.css";
import "./styles/mind-icons-extra.css";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
