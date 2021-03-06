import is from '@sindresorhus/is'
import {createLogger} from 'bunyan'
import * as Logger from 'bunyan'
import {isEmpty} from 'lodash'
import {AsyncParallelHook, AsyncSeriesBailHook} from 'tapable'
import {Service} from 'typedi'
import {VError} from 'verror'
import {Backend, IBackend} from './backend'
import {Client} from './client'
import {Config} from './config'
import {ProxyServer} from './proxy-server'

export abstract class MinecraftProxyPlugin {
  abstract name: string
  protected constructor(
    protected readonly server: ProxyServer, protected readonly plugin: PluginHook,
  ) {}
}

@Service()
export class PluginHook {
  public readonly hooks = Object.freeze({
    server: {
      lookupBackend: new AsyncSeriesBailHook<[string], IBackend>(['serverName']),
      prePipeToBackend: new AsyncParallelHook<[Client, Backend]>(['client', 'backend']),
    },
  })

  public readonly plugins = new Map<string, MinecraftProxyPlugin>()

  private readonly logger: Logger = createLogger({name: 'plugin'})

  constructor(
    private readonly config: Config,
    private readonly server: ProxyServer,
  ) {}

  public async loadPlugin(): Promise<void> {
    if (isEmpty(this.config.plugins)) return
    for (const pluginPackage of this.config.plugins) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const plugin = require(pluginPackage).default
        const instance = new plugin(this.server, this)
        let name = instance.name
        if (!name) {
          this.logger.warn(`${pluginPackage} has no name, using package name`)
          name = pluginPackage
        }
        if (this.plugins.has(name)) {
          this.logger.warn(`${pluginPackage} has conflict name ${name}, rename to ${pluginPackage}:${name}`)
          name = `${pluginPackage}:${name}`
        }
        this.plugins.set(name, instance)
        this.logger.info(`loaded plugin ${name}`)
      } catch (e) {
        throw new VError({
          cause: e,
        }, `failed to load plugin ${pluginPackage}`)
      }
    }
  }

  private constructPlugin(plugin: unknown): MinecraftProxyPlugin {
    if (!is.class_(plugin)) throw new VError(`${plugin} is not a constructor`)
    return new plugin(this.server, this) as MinecraftProxyPlugin
  }
}
