import { DesignSystemBrowser } from './preview/DesignSystemBrowser';
import { ThemeProvider } from 'next-themes';

function App() {
  return <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} storageKey="production-priority-docs-theme">
    <DesignSystemBrowser />
  </ThemeProvider>;
}

export default App;
