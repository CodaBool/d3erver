import { Router } from 'itty-router'
const router = Router()

/*         Clients         */
// downloads ZIP after token validation

router.get('/', async (request, env) => {
	const url = new URL(request.url)
	const token = url.searchParams.get("token")
	const module = url.searchParams.get("module")

	console.log("req url", request.url)

	if (!token || !module) {
		const country = request.headers.get('cf-ipcountry')
		const agent = request.headers.get('user-agent')
		const ip = request.headers.get('x-real-ip')
		console.log(`url missing query, likely a bot. country=${country} agent=${agent} ip=${ip}`)
		await email("d3erver 400 on GET / (Foundry clients)", `url missing query, likely a bot. country=${country} agent=${agent} ip=${ip}`, "DEBUG")
		return new Response('missing token or module query', { status: 400 })
	}

	const name = module.slice(0, -7)
	const tokenExists = await env.KV.get(token)

	if (!tokenExists) {
		console.log("unauthorized expired token", JSON.stringify(request, null, 2))
		await email("d3erver 403 on GET / (Foundry clients)", `Expired Token\n${JSON.stringify(request,null,2)}`, "DEBUG")
		return new Response('Expired token', { status: 403 })
	}

	const zip = await env.R2.get(module)

	if (zip === null) {
		console.error("Foundry client asked for module", module, "which does not exist")
		await email("d3erver 404 on GET / (Foundry clients)", `module ${module} does not exist`, "ERROR")
		return new Response(`module ${module} does not exist`, { status: 404 })
	}

	if (zip.status >= 400) {
		console.error(zip)
		await email("d3erver 500 on GET / (Foundry clients)", `couldn't get module ${module} from R2 ${JSON.stringify(zip, null, 2)}`, "ERROR")
		return new Response('Error fetching the zip file', { status: 500 })
	}

	await increment(env, "foundry", name)

	// Return the zip file
	return new Response(zip.body, {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="${name}.zip"`,
		}
	})
})

/*         The Forge         */
// password based downloads by providing a secret in module.json "download" URL
// Forge removes the "download" URL prop, making this secure (TM)

router.get('/forge', async (request, env) => {
	const url = new URL(request.url)
	const module = url.searchParams.get("module")
	const secret = url.searchParams.get("secret")

	// debug
	const country = request.headers.get('cf-ipcountry')
	const agent = request.headers.get('user-agent')
	const ip = request.headers.get('x-real-ip')
	console.log(`country=${country} agent=${agent} ip=${ip}`)

	if (!secret || !module) {
		console.log("unauthorized, could be a bot", url, JSON.stringify(request, null, 2), secret, module)
		await email("d3erver 400 on GET /forge (Forge server)", `url missing a query ${url} req ${JSON.stringify(request, null, 2)}`, "DEBUG")
		return new Response('missing module or unauthorized', { status: 400 })
	}

	if (secret !== env.FORGE_SECRET) {
		console.error("unauthorized", secret, JSON.stringify(request, null, 2))
		await email("d3erver 403 on GET /forge (Forge server)", `wrong secret ${secret} from ${JSON.stringify(request, null, 2)}`, "ERROR")
		return new Response("unauthorized", { status: 403 })
	}

	const zip = await env.R2.get(module)

	if (zip === null) {
		console.error("Forge server asked for module", module, "which does not exist")
		await email("d3erver 404 on GET /forge (Forge server)", `module ${module} does not exist`, "ERROR")
		return new Response(`module ${module} does not exist`, { status: 404 })
	}

	if (zip.status >= 400) {
		console.error(zip)
		await email("d3erver 500 on GET /forge (Forge server)", `couldn't get module ${module} from R2 ${JSON.stringify(zip, null, 2)}`, "ERROR")
		return new Response('Error fetching the zip file', { status: 500 })
	}

	const name = module.slice(0, -7)
	await increment(env, "forge", name)

	return new Response(zip.body, {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="${name}.zip"`,
		}
	})
})

/*         The Forge              */
// custom module.json for private packages, since a download and manifest contain secrets
// this cannot be public so it is dynamically created after validation

router.get('/manifest', async (request, env) => {
	const url = new URL(request.url)
	const moduleName = url.searchParams.get("module")
	const secret = url.searchParams.get("secret")

	// debug
	const country = request.headers.get('cf-ipcountry')
	const agent = request.headers.get('user-agent')
	const ip = request.headers.get('x-real-ip')
	console.log(`country=${country} agent=${agent} ip=${ip}`)

	if (agent === "node-fetch/1.0 (+https://github.com/bitinn/node-fetch)") {
		console.log('validated on agent')
	}
	if (ip === "15.235.53.129") {
		console.log('validated on ip')
	}
	if (country === "CA") {
		console.log('validated on country')
	}
	// tends to be === "15.235.53.129"
	// tends to be === node-fetch/1.0 (+https://github.com/bitinn/node-fetch)


	if (!secret || !moduleName) {

		console.log("url missing a query, could be a bot", url, JSON.stringify(request, null, 2))
		await email("d3erver 400 on GET /manifest (Forge server)", `url missing a query ${url} req ${JSON.stringify(request, null, 2)}`, "DEBUG")
		return new Response('missing module or secret query', { status: 400 })
	}

	if (secret !== env.FORGE_SECRET) {
		console.error("unauthorized", secret, JSON.stringify(request, null, 2))
		await email("d3erver 403 on GET /manifest (Forge server)", `wrong secret ${secret} from ${JSON.stringify(request, null, 2)}`, "ERROR")
		return new Response("unauthorized", { status: 403 })
	}

	// D1 will have values updated from module Github Actions
	const { data } = await env.D1.prepare("SELECT * FROM manifests").first()
  const template = JSON.parse(data)

	// append manifest and download props with secrets
  template.manifest = `https://d3erver.codabool.workers.dev/manifest?secret=${secret}&module=${moduleName}`
  template.download = `https://d3erver.codabool.workers.dev/forge?secret=${env.FORGE_SECRET}&module=terminal-v${template.version}`

	const secretJSON = JSON.stringify(template, null, 2)

	return new Response(secretJSON, {
		headers: {
			'Content-Type': 'application/json',
		}
	})
})

/*         Foundry Server         */
// creates a token in KV and returns JSON with a timed download URL

router.post('/', async (request, env)=> {
	const body = await request.json()
	const url = new URL(request.url)
	const allowedDomains = ["https://foundryvtt.com/", "https://api.foundryvtt.com/"]

	console.log("DEBUG: /post req", JSON.stringify(request, null, 2))

	if (!allowedDomains.some(allowed => url === allowed)) {
		console.log("initial block with body", body, "if this was a mistake allow additional domains", JSON.stringify(request, null, 2))
		if (body?.api_key !== env.FOUNDRY_SECRET) {
			console.log("unauthorized, could be a bot", JSON.stringify(request, null, 2), body?.api_key)
			await email("d3erver 403 on POST / (Foundry server)", `(could be bot)\nnot on allowed domain with ${JSON.stringify(request, null, 2)}\nand api_key did not match, found ${body?.api_key}`, "WARN")
			return new Response("unauthorized", { status: 403 })
		}
		await email("d3erver misconfigured allowlist on POST / (Foundry server)", `req from ${JSON.stringify(request, null, 2)} but passed api key. Add this domain to allowlist.`, "WARN")
		console.log("aborting block, match on API secret. Add new Foundry domain of", JSON.stringify(request, null, 2), "to allowlist!")
	}

	// 4h timed token
	const uuid = await crypto.randomUUID()
	await env.KV.put(uuid, body.user_id, { expirationTTL: 14400 })

	const data = JSON.stringify({
		package_name: body.package_name,
		version: body.version,
		download: `https://${env.DOMAIN}/?token=${uuid}&module=${body.package_name}-v${body.version}`,
	}, null, 2)

	return new Response(data, {
		headers: {
			'Content-Type': 'application/json',
		}
	})
})

// 404 for everything else
router.all('*', () => new Response('Not Found.', { status: 404 }))

// increment CloudFlare D1, SQLite for record keeping
async function increment(env, platform, module) {
	try {
		let date = new Date()
		date = date.getFullYear() + "-" + (date.getMonth() + 1)
		
		const { meta } = await env.D1.prepare(`UPDATE downloads SET total = total + 1 WHERE year_month = '${date}' and platform = '${platform}' AND module = '${module}'`).run()

		if (!meta.changes) {
			await env.D1.prepare(`INSERT OR IGNORE INTO downloads (platform, module, total, year_month) VALUES ('${platform}', '${module}', 1, '${date}')`).run()
		}
	} catch (err) {
		console.error(err)
		await email("increment error", JSON.stringify(err, null, 2), "ERROR")
	}
}

async function email(subject, value, name) {
	const mail = await fetch("https://api.mailchannels.net/tx/v1/send", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			personalizations: [{
				to: [{ email: "codabool@pm.me", name: "CodaBool" }],
			}],
			from: {email: "d3erver@codabool.com", name },
			content: [{ type: 'text/plain', value }],
			subject,
		})
	})
	
	const text = await mail.text()
	if (!mail.ok || mail.status > 299) {
		console.error(`Error sending email: ${mail.status} ${mail.statusText} ${text}`)
		return
	}
	console.log(text)
}

export default {
	async fetch(request, env, ctx) {
		return router.handle(request, env)
	}
}
