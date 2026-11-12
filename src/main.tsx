import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";
import "./order-status.css";
import "./admin-system.css";
import "./commerce-system.css";
import "./frontend-production.css";
import "./unified-system.css";
import "./light-system.css";
import "./reference-redesign.css";
import "./winter-system.css";
import "./urban-system.css";
import "./urban-home.css";
import "./urban-commerce.css";
import "./urban-secondary.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
