import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import POS from './pages/POS.jsx';
import Products from './pages/Products.jsx';
import Orders from './pages/Orders.jsx';
import Customers from './pages/Customers.jsx';
import Staff from './pages/Staff.jsx';
import Settings from './pages/Settings.jsx';
import GiftCards from './pages/GiftCards.jsx';
import Inventory from './pages/Inventory.jsx';
import Audit from './pages/Audit.jsx';
import Display from './pages/Display.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { useAuth } from './state/AuthContext.jsx';

function Protected({ children, perm, minRank }) {
  const { token, hasPerm, can } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  if (perm && !hasPerm(perm)) return <Navigate to="/" replace />;
  if (minRank && !can(minRank)) return <Navigate to="/" replace />;
  return children;
}

// Cashiers land on the register; everyone else sees the dashboard.
function HomeGate() {
  const { hasPerm } = useAuth();
  return hasPerm('reports') ? <Dashboard /> : <Navigate to="/pos" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/display" element={<Display />} />
      <Route element={<Protected><ErrorBoundary><Layout /></ErrorBoundary></Protected>}>
        <Route index element={<HomeGate />} />
        <Route path="pos" element={<POS />} />
        <Route
          path="products"
          element={
            <Protected perm="products">
              <Products />
            </Protected>
          }
        />
        <Route
          path="inventory"
          element={
            <Protected perm="inventory">
              <Inventory />
            </Protected>
          }
        />
        <Route path="orders" element={<Orders />} />
        <Route path="customers" element={<Customers />} />
        <Route
          path="gift-cards"
          element={
            <Protected perm="giftcards">
              <GiftCards />
            </Protected>
          }
        />
        <Route
          path="staff"
          element={
            <Protected minRank={3}>
              <Staff />
            </Protected>
          }
        />
        <Route
          path="settings"
          element={
            <Protected minRank={2}>
              <Settings />
            </Protected>
          }
        />
        <Route
          path="audit"
          element={
            <Protected minRank={3}>
              <Audit />
            </Protected>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
