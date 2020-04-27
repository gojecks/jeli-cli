import { bootStrap } from '@jeli/core';
import { AppModule } from './app/app.module';

bootStrap(AppModule, function() {
    console.log('App initialized');
});