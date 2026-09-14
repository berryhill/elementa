#!/usr/bin/env python3
"""Read-only signup diagnostics. Never emit secrets, addresses or raw errors."""
import json
import os
from pathlib import Path
import sys
import tempfile
from deploy import selected_kubeconfig, kube, failure_message

PROBE = r"""
const {MongoClient} = require('mongodb');
(async () => {
 const uri = process.env.MONGODB_URI;
 console.log(JSON.stringify({mongodbConfigured:!!uri,originMatches:process.env.SIGNUP_ALLOWED_ORIGIN==='https://elementafestival.com'}));
 if(!uri) return;
 let client;
 try {
  client = new MongoClient(uri,{serverSelectionTimeoutMS:5000,connectTimeoutMS:5000,socketTimeoutMS:5000});
  await client.connect();
  console.log(JSON.stringify({connection:'ok'}));
  await client.db('elementa').command({ping:1});
  console.log(JSON.stringify({ping:'ok'}));
  await client.db('elementa').collection('subscribers').findOne({_id:'elementa-issue21-qa@example.invalid'},{projection:{_id:1},maxTimeMS:5000});
  console.log(JSON.stringify({subscriberRead:'ok'}));
 } catch(e) {
  const names=['MongoServerError','MongoServerSelectionError','MongoParseError','MongoNetworkError','MongoNetworkTimeoutError'];
  console.log(JSON.stringify({error:names.includes(e.name)?e.name:'unclassified',code:Number.isInteger(e.code)?e.code:null,
   authenticationFailed:e.code===18,unauthorized:e.code===13,
   dnsFailure:/ENOTFOUND|EAI_AGAIN/.test(String(e.message)),
   connectionRefused:/ECONNREFUSED/.test(String(e.message)),
   tlsFailure:/certificate|TLS|SSL/i.test(String(e.message))}));
 } finally { if(client) await client.close(); }
})().catch(()=>{console.log('probe_failed');process.exitCode=1;});
"""

def inspect():
    with tempfile.TemporaryDirectory(prefix='elementa-signup-') as directory:
        with selected_kubeconfig(Path(directory), os.environ['LINODE_KUBECONFIG']):
            pods = json.loads(kube('get','pods','-l','app.kubernetes.io/instance=elementa','-o','json'))
            for pod in pods['items']:
                if pod.get('status',{}).get('phase') != 'Running':
                    continue
                print('SIGNUP_PROBE ' + kube('exec',pod['metadata']['name'],'--','node','-e',PROBE),flush=True)

if __name__ == '__main__':
    try:
        inspect()
    except Exception as error:
        print('Signup inspection FAILED: '+failure_message(error),file=sys.stderr)
        sys.exit(1)
