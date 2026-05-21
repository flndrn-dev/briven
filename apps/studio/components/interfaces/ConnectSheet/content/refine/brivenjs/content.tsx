import { MultipleCodeBlock } from 'ui-patterns/MultipleCodeBlock'

import type { StepContentProps } from '@/components/interfaces/ConnectSheet/Connect.types'

const ContentFile = ({ projectKeys }: StepContentProps) => {
  const files = [
    {
      name: '.env.local',
      language: 'bash',
      code: [
        `BRIVEN_URL=${projectKeys.apiUrl ?? 'your-project-url'}`,
        `BRIVEN_KEY=${projectKeys?.publishableKey ?? projectKeys?.anonKey ?? 'your-anon-key'}`,
        '',
      ].join('\n'),
    },
    {
      name: 'src/utility/brivenClient.ts',
      language: 'ts',
      code: `
import { createClient } from "@refinedev/briven";

const BRIVEN_URL = process.env.BRIVEN_URL;
const BRIVEN_KEY = process.env.BRIVEN_KEY;

export const brivenClient = createClient(BRIVEN_URL, BRIVEN_KEY, {
  db: {
    schema: "public",
  },
  auth: {
    persistSession: true,
  },
});
        `,
    },
    {
      name: 'src/App.tsx',
      language: 'tsx',
      code: `
import { Refine } from "@refinedev/core";
import { RefineKbar, RefineKbarProvider } from "@refinedev/kbar";
import routerProvider, {
  DocumentTitleHandler,
  NavigateToResource,
  UnsavedChangesNotifier,
} from "@refinedev/react-router";
import { dataProvider, liveProvider } from "@refinedev/briven";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import "./App.css";
import authProvider from "./authProvider";
import { brivenClient } from "./utility";
import { CountriesCreate, CountriesEdit, CountriesList, CountriesShow } from "./pages/countries";

function App() {
  return (
    <BrowserRouter>
      <RefineKbarProvider>
        <Refine
          dataProvider={dataProvider(brivenClient)}
          liveProvider={liveProvider(brivenClient)}
          authProvider={authProvider}
          routerProvider={routerProvider}
          options={{
            syncWithLocation: true,
            warnWhenUnsavedChanges: true,
          }}
          resources={[{
            name: "countries",
            list: "/countries",
            create: "/countries/create",
            edit: "/countries/edit/:id",
            show: "/countries/show/:id"
          }]}>
          <Routes>
            <Route index
              element={<NavigateToResource resource="countries" />}
            />
            <Route path="/countries">
              <Route index element={<CountriesList />} />
              <Route path="create" element={<CountriesCreate />} />
              <Route path="edit/:id" element={<CountriesEdit />} />
              <Route path="show/:id" element={<CountriesShow />} />
            </Route>
          </Routes>
          <RefineKbar />
          <UnsavedChangesNotifier />
          <DocumentTitleHandler />
        </Refine>
      </RefineKbarProvider>
    </BrowserRouter>
  );
}

export default App;
`,
    },
  ]

  return <MultipleCodeBlock files={files} />
}

export default ContentFile
