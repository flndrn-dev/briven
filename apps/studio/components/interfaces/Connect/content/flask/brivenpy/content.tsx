import { SimpleCodeBlock } from 'ui-patterns/SimpleCodeBlock'

import type { ContentFileProps } from '@/components/interfaces/Connect/Connect.types'
import {
  ConnectTabContent,
  ConnectTabs,
  ConnectTabTrigger,
  ConnectTabTriggers,
} from '@/components/interfaces/Connect/ConnectTabs'

const ContentFile = ({ projectKeys }: ContentFileProps) => {
  return (
    <ConnectTabs>
      <ConnectTabTriggers>
        <ConnectTabTrigger value=".env" />
        <ConnectTabTrigger value="app.py" />
      </ConnectTabTriggers>

      <ConnectTabContent value=".env">
        <SimpleCodeBlock className="bash" parentClassName="min-h-72">
          {`
BRIVEN_URL=${projectKeys.apiUrl ?? 'your-project-url'}
BRIVEN_KEY=${projectKeys.publishableKey ?? projectKeys.anonKey ?? 'your-anon-key'}
        `}
        </SimpleCodeBlock>
      </ConnectTabContent>

      <ConnectTabContent value="app.py">
        <SimpleCodeBlock className="python" parentClassName="min-h-72">
          {`
import os
from flask import Flask
from briven import create_client, Client
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

briven: Client = create_client(
    os.environ.get("BRIVEN_URL"),
    os.environ.get("BRIVEN_KEY")
)

@app.route('/')
def index():
    response = briven.table('todos').select("*").execute()
    todos = response.data

    html = '<h1>Todos</h1><ul>'
    for todo in todos:
        html += f'<li>{todo["name"]}</li>'
    html += '</ul>'

    return html

if __name__ == '__main__':
    app.run(debug=True)
`}
        </SimpleCodeBlock>
      </ConnectTabContent>
    </ConnectTabs>
  )
}

export default ContentFile
