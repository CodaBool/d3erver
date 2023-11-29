import dns from 'dns'

const ipv4 = await dns.resolve4("api.foundryvtt.com")

dns.resolve4('api.foundryvtt.com', (err, addresses) => {
  if (err) throw err;
  console.log(`addresses: ${JSON.stringify(addresses)}`);
});