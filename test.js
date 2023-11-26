// const template = await fetch('https://raw.githubusercontent.com/CodaBool/terminal/main/module.json')
// const json = await template.json()
// console.log("version", json.version)

// json.manifest = 'https://d3erver.codabool.workers.dev/manifest'
// json.download = `https://d3erver.codabool.workers.dev/forge?secret=${env.FORGE_SECRET}&module=terminal-v${version}`

// console.log(json)


// router.get('/manifest', async (request, env) => {
// 	const url = new URL(request.url)
// 	const module = url.searchParams.get("module")
// 	const secret = url.searchParams.get("secret")
// 	const name = module?.slice(0, -7)

// 	if (!secret || !module) {
// 		return new Response('missing token or secret query', { status: 400 })
// 	}

// 	if (secret !== env.FORGE_SECRET) {
// 		return new Response("unauthorized", { status: 403 })
// 	}
	
// 	const template = await fetch('https://raw.githubusercontent.com/CodaBool/terminal/main/module.json')

// 	const { meta } = await env.D1.prepare(`
// 		UPDATE downloads
// 		SET total = total + 1
// 		WHERE year_month = '${date}' and platform = '${platform}' AND module = '${module}';
// 	`).run()

// 	return new Response(zip.body, {
// 		headers: {
// 			'Content-Type': 'application/zip',
// 			'Content-Disposition': `attachment; filename="${name}.zip"`,
// 		}
// 	})
// })