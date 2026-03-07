import { SimulationProvider } from './context/SimulationContext';
import Layout from './components/Layout';

export default function App() {
  return (
    <SimulationProvider>
      <Layout />
    </SimulationProvider>
  );
}
