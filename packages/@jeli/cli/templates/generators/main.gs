import { bootStrapApplication } from '@jeli/core';
import { [NAME]Module } from './[PREFIX]/[PREFIX].module';

bootStrapApplication([NAME]Module, function() {
    console.log('[NAME] initialized');
});