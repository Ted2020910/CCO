import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import Overview from './pages/Overview';
import Sessions from './pages/Sessions';
import Records  from './pages/Records';
import './App.css';

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <aside className="sidebar">
          <div className="logo">
            <span className="logo-icon">🔭</span>
            <span className="logo-text">CCO</span>
          </div>
          <nav className="nav">
            <NavLink to="/"         end className={navCls}>📊 总览</NavLink>
            <NavLink to="/sessions"     className={navCls}>💬 Sessions</NavLink>
            <NavLink to="/records"      className={navCls}>📋 记录</NavLink>
          </nav>
          <div className="sidebar-footer">
            Claude Code Observer
          </div>
        </aside>

        <main className="main">
          <Routes>
            <Route path="/"         element={<Overview />} />
            <Route path="/sessions" element={<Sessions />} />
            <Route path="/records"  element={<Records  />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

function navCls({ isActive }: { isActive: boolean }) {
  return `nav-item${isActive ? ' nav-item--active' : ''}`;
}
