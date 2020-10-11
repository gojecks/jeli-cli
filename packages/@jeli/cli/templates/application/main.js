import { bootStrapApplication } from '@jeli/core';
import { AppModule } from './app/app.module';

bootStrapApplication(AppModule, function() {
    console.log('App initialized');
});