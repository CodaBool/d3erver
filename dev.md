`npx wrangler d1 execute foundry --command="SELECT * FROM manifests"`

reverse ip lookup
https://mxtoolbox.com/ReverseLookup.aspx

ip location
https://iplocation.com


# all the headers I get from a req

```
"accept",
"accept-encoding",
"cf-connecting-ip",
"cf-ipcountry",
"cf-ray", = hash of datacenter
"cf-visitor",
"connection",
"host",
"user-agent",
"x-forwarded-proto",
"x-real-ip",
```

# can get IP records with dns
```js
import dns from 'dns'
const ipv4 = await dns.resolve4("api.foundryvtt.com")
```
