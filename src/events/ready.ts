import { Client, ChannelType, TextChannel } from 'discord.js';
import { config } from '../config.js';
import { log } from '../index.js';

// Cache of discovered user IDs (populated from messages)
const knownUserIds: Record<string, string> = {};

/**
 * Apply private channel permissions once we know the user IDs.
 * Called lazily — the first time we see a message from bertrand or Mo.
 */
export async function ensurePrivateChannelPermissions(client: Client, guild: import('discord.js').Guild): Promise<void> {
  const privateChannel = guild.channels.cache.find(
    c => c.name === config.privateChannel.name && c.type === ChannelType.GuildText
  ) as TextChannel | undefined;

  if (!privateChannel) return;

  try {
    // @everyone: read-only
    await privateChannel.permissionOverwrites.edit(guild.roles.everyone, {
      ViewChannel: true,
      SendMessages: false,
      AddReactions: true,
      ReadMessageHistory: true,
    });

    // Bot: can send
    await privateChannel.permissionOverwrites.edit(client.user!.id, {
      ViewChannel: true,
      SendMessages: true,
      EmbedLinks: true,
      AttachFiles: true,
    });

    // Bertrand: can send
    const bertrandId = knownUserIds[config.primaryInvestor.username.toLowerCase()];
    if (bertrandId) {
      await privateChannel.permissionOverwrites.edit(bertrandId, {
        ViewChannel: true,
        SendMessages: true,
        AddReactions: true,
        ReadMessageHistory: true,
      });
      log(`[${guild.name}] #${config.privateChannel.name} — bertrand (${bertrandId}) granted send access`);
    }

    // Mo (owner): full access — may fail if Mo is server owner (already has all perms)
    const ownerId = knownUserIds[config.owner.username.toLowerCase()];
    if (ownerId) {
      try {
        await privateChannel.permissionOverwrites.edit(ownerId, {
          ViewChannel: true,
          SendMessages: true,
          ManageMessages: true,
          AddReactions: true,
          ReadMessageHistory: true,
          EmbedLinks: true,
          AttachFiles: true,
        });
        log(`[${guild.name}] #${config.privateChannel.name} — Mo (${ownerId}) granted full access`);
      } catch {
        // Server owner already has full access — this is expected
        log(`[${guild.name}] #${config.privateChannel.name} — Mo is server owner, already has full access`);
      }
    }
  } catch (err) {
    log(`[${guild.name}] Failed to set permissions on #${config.privateChannel.name}: ${err}`);
  }
}

/**
 * Register a user ID we've discovered from a message.
 * If it's bertrand or Mo and we haven't set their permissions yet, do it now.
 */
export function registerDiscoveredUser(username: string, userId: string, client: Client): void {
  const lower = username.toLowerCase();
  if (knownUserIds[lower]) return; // Already known

  const isRelevant = lower === config.primaryInvestor.username.toLowerCase()
    || lower === config.owner.username.toLowerCase();

  if (!isRelevant) return;

  knownUserIds[lower] = userId;
  log(`[user-discovery] Discovered ${username} = ${userId}`);

  // Apply permissions to all guilds
  for (const guild of client.guilds.cache.values()) {
    ensurePrivateChannelPermissions(client, guild);
  }
}

/**
 * Set up auto-channels when the bot starts or joins a guild.
 */
async function setupChannels(client: Client, guild: import('discord.js').Guild): Promise<void> {
  try {
    const existingChannels = guild.channels.cache.map(c => c.name);

    // Check if we need to create anything
    const missing = config.autoChannels.filter(ch => !existingChannels.includes(ch.name));

    if (missing.length === 0) {
      // Channels exist — try to set permissions with whatever user IDs we already know
      await ensurePrivateChannelPermissions(client, guild);
      log(`[${guild.name}] All channels already exist`);
      return;
    }

    // Find or create the Trading category
    let category = guild.channels.cache.find(
      c => c.name === 'Trading' && c.type === ChannelType.GuildCategory
    );

    if (!category) {
      category = await guild.channels.create({
        name: 'Trading',
        type: ChannelType.GuildCategory,
        reason: 'Neutron trading bot setup',
      });
      log(`[${guild.name}] Created "Trading" category`);
    }

    // Create missing channels
    for (const ch of missing) {
      const createOptions: any = {
        name: ch.name,
        type: ChannelType.GuildText,
        topic: ch.topic,
        parent: category.id,
        reason: 'Neutron trading bot setup',
      };

      // Set permission overrides at creation time for the private channel
      if (ch.name === config.privateChannel.name) {
        const overwrites: any[] = [
          // @everyone: read-only
          {
            id: guild.roles.everyone.id,
            allow: ['ViewChannel', 'ReadMessageHistory', 'AddReactions'],
            deny: ['SendMessages'],
          },
          // Bot: can send
          {
            id: client.user!.id,
            allow: ['ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles', 'ReadMessageHistory'],
          },
        ];

        const bertrandId = knownUserIds[config.primaryInvestor.username.toLowerCase()];
        if (bertrandId) {
          overwrites.push({
            id: bertrandId,
            allow: ['ViewChannel', 'SendMessages', 'AddReactions', 'ReadMessageHistory'],
          });
        }

        const ownerId = knownUserIds[config.owner.username.toLowerCase()];
        if (ownerId) {
          overwrites.push({
            id: ownerId,
            allow: ['ViewChannel', 'SendMessages', 'ManageMessages', 'AddReactions', 'ReadMessageHistory', 'EmbedLinks', 'AttachFiles'],
          });
        }

        createOptions.permissionOverwrites = overwrites;
      }

      await guild.channels.create(createOptions);
      log(`[${guild.name}] Created #${ch.name}`);
    }

    log(`[${guild.name}] Channel setup complete (${missing.length} created)`);
  } catch (err) {
    log(`[${guild.name}] Failed to setup channels: ${err}`);
  }
}

/**
 * Try to find bertrand and Mo upfront via member search (requires GuildMembers intent).
 */
async function discoverUsersUpfront(guild: import('discord.js').Guild): Promise<void> {
  for (const username of [config.primaryInvestor.username, config.owner.username]) {
    try {
      const members = await guild.members.fetch({ query: username, limit: 5 });
      const member = members.find(m => m.user.username.toLowerCase() === username.toLowerCase());
      if (member) {
        knownUserIds[username.toLowerCase()] = member.id;
        log(`[${guild.name}] Found ${username}: ${member.user.tag} (${member.id})`);
      }
    } catch {
      // GuildMembers intent might not be available — we'll discover via messages
    }
  }
}

export function registerReadyEvent(client: Client): void {
  client.once('ready', async (c) => {
    log(`Neutron online as ${c.user.tag} — connected to ${c.guilds.cache.size} server(s)`);

    for (const guild of c.guilds.cache.values()) {
      // Try upfront member discovery (may fail without GuildMembers intent — that's fine)
      await discoverUsersUpfront(guild).catch(() => {});
      await setupChannels(client, guild);
    }
  });

  client.on('guildCreate', async (guild) => {
    log(`Joined new server: ${guild.name}`);
    await setupChannels(client, guild);
  });
}
