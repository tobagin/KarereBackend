#!/usr/bin/env node

import Database from './database.js';

async function addTestContacts() {
    try {
        console.log('Initializing database...');
        await Database.initialize();
        console.log('Adding test contacts...');
        
        // Sample contacts with Brazilian and international numbers
        const testContacts = [
            { jid: '5511985477737@s.whatsapp.net', name: 'João Silva', phone: '+55 11 98547-7737' },
            { jid: '557191810698@s.whatsapp.net', name: 'Maria Santos', phone: '+55 71 91810-698' },
            { jid: '557199699666@s.whatsapp.net', name: 'Pedro Costa', phone: '+55 71 99699-666' },
            { jid: '351919169435@s.whatsapp.net', name: 'Ana Oliveira', phone: '+351 919 169 435' },
            { jid: '351918288742@s.whatsapp.net', name: 'Carlos Ferreira', phone: '+351 918 288 742' },
            { jid: '15125254813@s.whatsapp.net', name: 'John Smith', phone: '+1 512 525 4813' },
            { jid: '17817096861@s.whatsapp.net', name: 'Sarah Johnson', phone: '+1 781 709 6861' },
            { jid: '61422946008@s.whatsapp.net', name: 'Michael Brown', phone: '+61 422 946 008' },
            { jid: '353871754287@s.whatsapp.net', name: 'Emma Wilson', phone: '+353 87 175 4287' },
            { jid: '12679750570@s.whatsapp.net', name: 'David Miller', phone: '+1 267 975 0570' }
        ];
        
        for (const contact of testContacts) {
            await Database.saveContact(contact.jid, contact.name, contact.phone);
            console.log(`Added contact: ${contact.name} (${contact.jid})`);
        }
        
        console.log('Test contacts added successfully!');
        
    } catch (error) {
        console.error('Error adding test contacts:', error);
    } finally {
        await Database.close();
    }
}

addTestContacts();
