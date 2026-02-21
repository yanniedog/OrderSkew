export class CoordinatorDO {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(): Promise<Response> {
    const count = (await this.state.storage.get<number>('pingCount')) ?? 0
    const next = count + 1
    await this.state.storage.put('pingCount', next)
    return Response.json({ ok: true, pingCount: next })
  }
}