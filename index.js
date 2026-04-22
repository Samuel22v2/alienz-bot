const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionFlagsBits, AuditLogEvent } = require('discord.js');
const OpenAI = require('openai');
const fs = require('fs');

// ===== TOKENS =====
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const OPENAI_KEY = process.env.OPENAI_KEY;

// ===== CONFIG =====
const LOG_CHANNEL_NAME = 'alienz-logs'; // nome do canal de logs no teu servidor
const WARN_LIMIT = 3; // avisos antes de banir

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
});

const openai = new OpenAI({ apiKey: OPENAI_KEY });

// Armazena avisos por user
const warns = {};

// Padrões de spam/links suspeitos
const SPAM_PATTERNS = [
  /discord\.gg\/[a-zA-Z0-9]+/i,
  /https?:\/\/[^\s]+/i,
  /check.*bio/i,
  /free.*nitro/i,
  /click.*link/i,
  /t\.me\//i,
  /bit\.ly\//i,
];

// ===== FUNÇÕES UTILITÁRIAS =====

function isSpam(content) {
  return SPAM_PATTERNS.some(p => p.test(content));
}

async function sendLog(guild, embed) {
  const logChannel = guild.channels.cache.find(c => c.name === LOG_CHANNEL_NAME);
  if (logChannel) logChannel.send({ embeds: [embed] });
}

function addWarn(userId) {
  warns[userId] = (warns[userId] || 0) + 1;
  return warns[userId];
}

async function punishUser(message, reason) {
  const member = message.member;
  if (!member) return;

  const count = addWarn(message.author.id);

  try {
    await message.delete();
  } catch {}

  const embed = new EmbedBuilder()
    .setColor(count >= WARN_LIMIT ? 0xff0000 : 0xff9900)
    .setTitle(count >= WARN_LIMIT ? '🔨 Usuário Banido' : '⚠️ Aviso de Spam')
    .addFields(
      { name: 'Usuário', value: `${message.author.tag} (${message.author.id})`, inline: true },
      { name: 'Canal', value: `<#${message.channel.id}>`, inline: true },
      { name: 'Motivo', value: reason },
      { name: 'Avisos', value: `${count}/${WARN_LIMIT}` },
      { name: 'Mensagem', value: message.content.slice(0, 200) || 'N/A' }
    )
    .setTimestamp();

  await sendLog(message.guild, embed);

  if (count >= WARN_LIMIT) {
    try {
      await member.ban({ reason: `Spam automático: ${reason}` });
      delete warns[message.author.id];
    } catch {}
  } else {
    try {
      await message.channel.send(`<@${message.author.id}> ⚠️ Aviso ${count}/${WARN_LIMIT}: ${reason}`);
    } catch {}
  }
}

// ===== ANTI SPAM REPETIDO =====
const recentMessages = {};

function isRepeatSpam(userId, content) {
  const now = Date.now();
  if (!recentMessages[userId]) recentMessages[userId] = [];
  recentMessages[userId] = recentMessages[userId].filter(m => now - m.time < 10000);
  recentMessages[userId].push({ content, time: now });
  const dupes = recentMessages[userId].filter(m => m.content === content);
  return dupes.length >= 3;
}

// ===== EVENTOS =====

client.once('ready', () => {
  console.log(`✅ Alienz IA Online: ${client.user.tag}`);
  client.user.setActivity('👁️ Vigiando o servidor 24h', { type: 3 });
});

// Vigilância de mensagens
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const content = message.content;

  // Verifica spam de links/bio
  if (isSpam(content)) {
    await punishUser(message, 'Link suspeito / check bio / convite não autorizado');
    return;
  }

  // Verifica mensagens repetidas
  if (isRepeatSpam(message.author.id, content)) {
    await punishUser(message, 'Spam de mensagens repetidas');
    return;
  }

  // Comando !ask para falar com a IA
  if (content.startsWith('!ask ')) {
    const question = content.slice(5);
    try {
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Você é Alienz, uma IA assistente de servidor Discord. Seja útil, direto e amigável.' },
          { role: 'user', content: question }
        ],
        max_tokens: 500,
      });
      const reply = res.choices[0].message.content;
      message.reply(`🤖 ${reply}`);
    } catch (e) {
      message.reply('❌ Erro ao contactar a IA.');
    }
    return;
  }

  // Comando !warns
  if (content === '!warns') {
    const userWarns = warns[message.author.id] || 0;
    message.reply(`⚠️ Tens ${userWarns}/${WARN_LIMIT} avisos.`);
    return;
  }

  // Comando !clearwarns (só admins)
  if (content.startsWith('!clearwarns ')) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
    const mention = message.mentions.users.first();
    if (mention) {
      delete warns[mention.id];
      message.reply(`✅ Avisos de ${mention.tag} limpos.`);
    }
    return;
  }

  // Comando !ban (só admins)
  if (content.startsWith('!ban ')) {
    if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) return;
    const mention = message.mentions.members.first();
    const reason = content.split(' ').slice(2).join(' ') || 'Sem motivo';
    if (mention) {
      await mention.ban({ reason });
      message.reply(`🔨 ${mention.user.tag} foi banido. Motivo: ${reason}`);
      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('🔨 Ban Manual')
        .addFields(
          { name: 'Banido', value: mention.user.tag, inline: true },
          { name: 'Por', value: message.author.tag, inline: true },
          { name: 'Motivo', value: reason }
        )
        .setTimestamp();
      await sendLog(message.guild, embed);
    }
    return;
  }

  // Comando !kick (só admins)
  if (content.startsWith('!kick ')) {
    if (!message.member.permissions.has(PermissionFlagsBits.KickMembers)) return;
    const mention = message.mentions.members.first();
    const reason = content.split(' ').slice(2).join(' ') || 'Sem motivo';
    if (mention) {
      await mention.kick(reason);
      message.reply(`👢 ${mention.user.tag} foi kickado. Motivo: ${reason}`);
    }
    return;
  }

  // Comando !help
  if (content === '!help') {
    const embed = new EmbedBuilder()
      .setColor(0x7289da)
      .setTitle('🤖 Alienz IA - Comandos')
      .setDescription('Bot de vigilância 24h com IA integrada')
      .addFields(
        { name: '!ask [pergunta]', value: 'Fala com a IA' },
        { name: '!warns', value: 'Ver teus avisos' },
        { name: '!clearwarns @user', value: 'Limpar avisos (Admin)' },
        { name: '!ban @user [motivo]', value: 'Banir usuário (Admin)' },
        { name: '!kick @user [motivo]', value: 'Kickar usuário (Admin)' },
        { name: '!serverinfo', value: 'Info do servidor' },
        { name: '!userinfo @user', value: 'Info de um usuário' },
      )
      .setFooter({ text: 'Alienz IA • Vigilância 24h' });
    message.reply({ embeds: [embed] });
    return;
  }

  // Comando !serverinfo
  if (content === '!serverinfo') {
    const g = message.guild;
    const embed = new EmbedBuilder()
      .setColor(0x00ff99)
      .setTitle(`📊 ${g.name}`)
      .addFields(
        { name: 'Membros', value: `${g.memberCount}`, inline: true },
        { name: 'Criado em', value: g.createdAt.toLocaleDateString('pt-BR'), inline: true },
        { name: 'Dono', value: `<@${g.ownerId}>`, inline: true },
      )
      .setThumbnail(g.iconURL())
      .setTimestamp();
    message.reply({ embeds: [embed] });
    return;
  }

  // Comando !userinfo
  if (content.startsWith('!userinfo')) {
    const target = message.mentions.members.first() || message.member;
    const embed = new EmbedBuilder()
      .setColor(0x00aaff)
      .setTitle(`👤 ${target.user.tag}`)
      .addFields(
        { name: 'ID', value: target.id, inline: true },
        { name: 'Entrou', value: target.joinedAt.toLocaleDateString('pt-BR'), inline: true },
        { name: 'Conta criada', value: target.user.createdAt.toLocaleDateString('pt-BR'), inline: true },
        { name: 'Avisos', value: `${warns[target.id] || 0}/${WARN_LIMIT}`, inline: true },
      )
      .setThumbnail(target.user.displayAvatarURL())
      .setTimestamp();
    message.reply({ embeds: [embed] });
    return;
  }
});

// Log de entrada de membros
client.on('guildMemberAdd', async (member) => {
  const embed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle('✅ Novo Membro')
    .addFields(
      { name: 'Usuário', value: `${member.user.tag} (${member.id})` },
      { name: 'Conta criada', value: member.user.createdAt.toLocaleDateString('pt-BR') },
      { name: 'Membros totais', value: `${member.guild.memberCount}` }
    )
    .setThumbnail(member.user.displayAvatarURL())
    .setTimestamp();
  await sendLog(member.guild, embed);
});

// Log de saída de membros
client.on('guildMemberRemove', async (member) => {
  const embed = new EmbedBuilder()
    .setColor(0xff4444)
    .setTitle('❌ Membro Saiu')
    .addFields(
      { name: 'Usuário', value: `${member.user.tag} (${member.id})` }
    )
    .setTimestamp();
  await sendLog(member.guild, embed);
});

// Log de mensagens deletadas
client.on('messageDelete', async (message) => {
  if (!message.guild || message.author?.bot) return;
  const embed = new EmbedBuilder()
    .setColor(0xff6600)
    .setTitle('🗑️ Mensagem Deletada')
    .addFields(
      { name: 'Usuário', value: message.author?.tag || 'Desconhecido', inline: true },
      { name: 'Canal', value: `<#${message.channel.id}>`, inline: true },
      { name: 'Conteúdo', value: message.content?.slice(0, 300) || 'N/A' }
    )
    .setTimestamp();
  await sendLog(message.guild, embed);
});

client.login(DISCORD_TOKEN);
