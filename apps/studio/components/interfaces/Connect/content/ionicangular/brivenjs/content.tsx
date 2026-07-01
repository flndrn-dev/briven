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
        <ConnectTabTrigger value="environments/environment.ts" />
        <ConnectTabTrigger value="src/app/briven.service.ts" />
        <ConnectTabTrigger value="src/app/app.component.ts" />
        <ConnectTabTrigger value="src/app/app.component.html" />
        <ConnectTabTrigger value="src/app/app.module.ts" />
      </ConnectTabTriggers>

      <ConnectTabContent value="environments/environment.ts">
        <SimpleCodeBlock className="ts" parentClassName="min-h-72">
          {`
export const environment = {
  brivenUrl: '${projectKeys.apiUrl ?? 'your-project-url'}',
  brivenKey: '${projectKeys.publishableKey ?? '<prefer publishable key instead of anon key for mobile apps>'}',
};
`}
        </SimpleCodeBlock>
      </ConnectTabContent>

      <ConnectTabContent value="src/app/briven.service.ts">
        <SimpleCodeBlock className="ts" parentClassName="min-h-72">
          {`
import { Injectable } from '@angular/core';
import { createClient, BrivenClient } from '@supabase/supabase-js';
import { environment } from '../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class BrivenService {
  private briven: BrivenClient;
  constructor() {
    this.briven = createClient(
      environment.brivenUrl,
      environment.brivenKey
    );
  }

  getTodos() {
    return this.briven.from('todos').select('*');
  }
}
`}
        </SimpleCodeBlock>
      </ConnectTabContent>

      <ConnectTabContent value="src/app/app.component.ts">
        <SimpleCodeBlock className="ts" parentClassName="min-h-72">
          {`
import { Component, OnInit } from '@angular/core';
import { BrivenService } from './briven.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
})
export class AppComponent implements OnInit {
  todos: any[] = [];

  constructor(private brivenService: BrivenService) {}

  async ngOnInit() {
    await this.loadTodos();
  }

  async loadTodos() {
    const { data, error } = await this.brivenService.getTodos();
    if (error) {
      console.error('Error fetching todos:', error);
    } else {
      this.todos = data;
    }
  }
}
`}
        </SimpleCodeBlock>
      </ConnectTabContent>

      <ConnectTabContent value="src/app/app.component.html">
        <SimpleCodeBlock className="html" parentClassName="min-h-72">
          {`
<ion-header>
<ion-toolbar>
  <ion-title>Todo List</ion-title>
</ion-toolbar>
</ion-header>

<ion-content>
<ion-list>
  <ion-item *ngFor="let todo of todos">
    <ion-label>{{ todo.title }}</ion-label>
  </ion-item>
</ion-list>
</ion-content>
`}
        </SimpleCodeBlock>
      </ConnectTabContent>

      <ConnectTabContent value="src/app/app.module.ts">
        <SimpleCodeBlock className="ts" parentClassName="min-h-72">
          {`
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BrowserModule } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';

import { IonicModule } from '@ionic/angular';

import { AppComponent } from './app.component';
import { BrivenService } from './briven.service';

@NgModule({
  imports: [
    BrowserModule,
    FormsModule,
    RouterModule.forRoot([]),
    IonicModule.forRoot({ mode: 'ios' }),
  ],
  declarations: [AppComponent],
  providers: [BrivenService],
  bootstrap: [AppComponent],
})
export class AppModule {}
`}
        </SimpleCodeBlock>
      </ConnectTabContent>
    </ConnectTabs>
  )
}

export default ContentFile
