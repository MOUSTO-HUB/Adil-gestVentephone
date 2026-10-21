import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  creerSmsSender,
  creerWhatsAppSender,
  SMS_SENDER,
  WHATSAPP_SENDER,
} from './fournisseurs.js';
import { FacturePubliqueController, MessagesController } from './messages.controller.js';
import { MessagesService } from './messages.service.js';

/** Messages aux clients (SMS, WhatsApp) : seul point d'envoi de l'application. */
@Global()
@Module({
  controllers: [MessagesController, FacturePubliqueController],
  providers: [
    MessagesService,
    { provide: SMS_SENDER, useFactory: creerSmsSender, inject: [ConfigService] },
    { provide: WHATSAPP_SENDER, useFactory: creerWhatsAppSender, inject: [ConfigService] },
  ],
  exports: [MessagesService],
})
export class MessagesModule {}
