import dns from 'dns'

dns.resolve4('api.foundryvtt.com', (err, addresses) => {
  if (err) throw err;
  console.log(`addresses: ${JSON.stringify(addresses)}`);
});
