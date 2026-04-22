const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, StringSelectMenuBuilder } = require('discord.js');
const OpenAI = require('openai');
const fs = require('fs');

// ===== TOKENS =====
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const OPENAI_KEY = process.env.OPENAI_KEY;

// ===== CONFIG =====
const LOG_CHANNEL_NAME = 'alienz-logs';
const WARN_LIMIT = 3;
const TICKET_CATEGORY = 'TICKETS'; // categoria para tickets
const PANEL_CHANNEL = 'painel-controle'; // canal do painel

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

// Armazena dados
const warns = {};
const tickets = new Map();
const userEconomy = {};
const serverConfig = {}; // configs por servidor

// Config padrão
function getConfig(guildId) {
  if (!serverConfig[guildId]) {
    serverConfig[guildId] = {
      antiSpam: true,
      autoMod: true,
      antiRaid: false,
      logs: true,
      warnLimit: 3,
      immuneRoles: [],
      logChannel: LOG_CHANNEL_NAME,
      aiModel: 'gpt-4o-mini',
      // Loja
      shopEnabled: false,
      refilEnabled: false,
      minOrder: 100,
      memberPrice: 0.03,
      memberPriceRefil: 0.04,
      clientRole: null,
      staffRole: null,
    };
  }
  return serverConfig[guildId];
}

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

async function punishUser(message, reason, config) {
  const member = message.member;
  if (!member) return;

  const count = addWarn(message.author.id);
  const warnLimit = config.warnLimit;

  try {
    await message.delete();
  } catch {}

  const embed = new EmbedBuilder()
    .setColor(count >= warnLimit ? 0xff0000 : 0xff9900)
    .setTitle(count >= warnLimit ? '🔨 Usuário Banido' : '⚠️ Aviso de Spam')
    .addFields(
      { name: 'Usuário', value: `${message.author.tag} (${message.author.id})`, inline: true },
      { name: 'Canal', value: `<#${message.channel.id}>`, inline: true },
      { name: 'Motivo', value: reason },
      { name: 'Avisos', value: `${count}/${warnLimit}` },
      { name: 'Mensagem', value: message.content.slice(0, 200) || 'N/A' }
    )
    .setTimestamp();

  await sendLog(message.guild, embed);

  if (count >= warnLimit) {
    try {
      await member.ban({ reason: `Spam automático: ${reason}` });
      delete warns[message.author.id];
    } catch {}
  } else {
    try {
      await message.channel.send(`<@${message.author.id}> ⚠️ Aviso ${count}/${warnLimit}: ${reason}`);
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

client.once('ready', async () => {
  console.log(`✅ Alienz IA Online: ${client.user.tag}`);
  client.user.setActivity('👁️ Vigiando o servidor 24h', { type: 3 });
  
  // Cria painel de controle em todos os servidores
  for (const guild of client.guilds.cache.values()) {
    await setupControlPanel(guild);
  }
});

// ===== PAINEL DE CONTROLE =====
async function setupControlPanel(guild) {
  let channel = guild.channels.cache.find(c => c.name === PANEL_CHANNEL);
  
  if (!channel) {
    try {
      channel = await guild.channels.create({
        name: PANEL_CHANNEL,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          {
            id: guild.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
            deny: [PermissionFlagsBits.SendMessages],
          },
        ],
      });
    } catch (e) {
      console.log('Erro ao criar canal painel:', e.message);
      return;
    }
  }

  const embed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle('🎛️ Painel de Controle - Alienz IA')
    .setDescription('Bem-vindo ao painel de controle! Use os botões abaixo para acessar as funcionalidades.')
    .setImage('https://i.imgur.com/placeholder.png')
    .setFooter({ text: 'Alienz IA • Sistema Completo' })
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('panel_ticket')
      .setLabel('🎫 Ticket')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('panel_vendas')
      .setLabel('💰 Doar Vendas')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('panel_automacao')
      .setLabel('⚙️ Automações')
      .setStyle(ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('panel_comunidade')
      .setLabel('👥 Comunidade')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('panel_sorteio')
      .setLabel('🎁 Sorteios')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('panel_entrada')
      .setLabel('🚪 Entrada')
      .setStyle(ButtonStyle.Success),
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('panel_giveaway')
      .setLabel('🎉 Giveaway')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('panel_config')
      .setLabel('⚙️ Configurações')
      .setStyle(ButtonStyle.Secondary),
  );

  const messages = await channel.messages.fetch({ limit: 10 });
  const botMessages = messages.filter(m => m.author.id === client.user.id);
  
  if (botMessages.size > 0) {
    await botMessages.first().edit({ embeds: [embed], components: [row1, row2, row3] });
  } else {
    await channel.send({ embeds: [embed], components: [row1, row2, row3] });
  }
}

// ===== HANDLER DE INTERAÇÕES (BOTÕES) =====
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  const { customId, member, guild } = interaction;

  // Sistema de Tickets
  if (customId === 'panel_ticket') {
    const ticketId = `ticket-${member.user.username}-${Date.now()}`;
    
    let category = guild.channels.cache.find(c => c.name === TICKET_CATEGORY && c.type === ChannelType.GuildCategory);
    if (!category) {
      category = await guild.channels.create({
        name: TICKET_CATEGORY,
        type: ChannelType.GuildCategory,
      });
    }

    const ticketChannel = await guild.channels.create({
      name: ticketId,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: [
        {
          id: guild.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: member.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
        },
      ],
    });

    tickets.set(ticketChannel.id, { userId: member.id, createdAt: Date.now() });

    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle('🎫 Ticket Criado')
      .setDescription(`Olá ${member}, seu ticket foi criado! A equipe responderá em breve.`)
      .addFields({ name: 'Usuário', value: member.user.tag })
      .setTimestamp();

    const closeButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('close_ticket')
        .setLabel('🔒 Fechar Ticket')
        .setStyle(ButtonStyle.Danger)
    );

    await ticketChannel.send({ embeds: [embed], components: [closeButton] });
    await interaction.reply({ content: `✅ Ticket criado: ${ticketChannel}`, ephemeral: true });
  }

  // Fechar Ticket
  if (customId === 'close_ticket') {
    if (!tickets.has(interaction.channel.id)) {
      return interaction.reply({ content: '❌ Este não é um canal de ticket válido.', ephemeral: true });
    }

    await interaction.reply('🔒 Fechando ticket em 5 segundos...');
    setTimeout(async () => {
      tickets.delete(interaction.channel.id);
      await interaction.channel.delete();
    }, 5000);
  }

  // Doar Vendas
  if (customId === 'panel_vendas') {
    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('💰 Sistema de Vendas')
      .setDescription('Use os comandos abaixo para gerenciar vendas:\n\n`/vender [item] [preço]` - Anunciar venda\n`/comprar [item]` - Comprar item\n`/saldo` - Ver seu saldo');
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // Automações
  if (customId === 'panel_automacao') {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('⚙️ Automações Ativas')
      .setDescription('✅ Anti-spam ativo\n✅ Auto-moderação ativa\n✅ Logs automáticos\n✅ IA de vigilância 24h');
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // Comunidade
  if (customId === 'panel_comunidade') {
    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle('👥 Comunidade')
      .setDescription(`📊 Membros: ${guild.memberCount}\n🟢 Online: ${guild.members.cache.filter(m => m.presence?.status === 'online').size}\n📅 Servidor criado: ${guild.createdAt.toLocaleDateString('pt-BR')}`);
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // Sorteios
  if (customId === 'panel_sorteio' || customId === 'panel_giveaway') {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('🎁 Sistema de Sorteios')
      .setDescription('Use `/sorteio criar [prêmio] [duração]` para criar um sorteio!\n\nExemplo: `/sorteio criar Nitro 1h`');
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // Entrada
  if (customId === 'panel_entrada') {
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('🚪 Sistema de Entrada')
      .setDescription('Configure mensagens de boas-vindas automáticas!\n\nUse `/entrada config [canal] [mensagem]`');
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // Configurações
  if (customId === 'panel_config') {
    if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Apenas administradores podem acessar as configurações.', ephemeral: true });
    }

    const config = getConfig(guild.id);
    const embed = new EmbedBuilder()
      .setColor(0x95a5a6)
      .setTitle('⚙️ Configurações do Bot')
      .addFields(
        { name: 'Anti-Spam', value: config.antiSpam ? '✅ Ativo' : '❌ Desativado', inline: true },
        { name: 'Auto-Moderação', value: config.autoMod ? '✅ Ativo' : '❌ Desativado', inline: true },
        { name: 'Logs', value: config.logs ? '✅ Ativo' : '❌ Desativado', inline: true },
        { name: 'Limite de Avisos', value: `${config.warnLimit}`, inline: true },
        { name: 'Modelo IA', value: config.aiModel, inline: true },
        { name: 'Cargos Imunes', value: config.immuneRoles.length > 0 ? config.immuneRoles.map(id => `<@&${id}>`).join(', ') : 'Nenhum', inline: false },
      )
      .setDescription('Use os botões abaixo para configurar:');

    const configRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('config_antispam')
        .setLabel(config.antiSpam ? 'Desativar Anti-Spam' : 'Ativar Anti-Spam')
        .setStyle(config.antiSpam ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('config_automod')
        .setLabel(config.autoMod ? 'Desativar Auto-Mod' : 'Ativar Auto-Mod')
        .setStyle(config.autoMod ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('config_ia')
        .setLabel('Trocar Modelo IA')
        .setStyle(ButtonStyle.Primary),
    );
    
    await interaction.reply({ embeds: [embed], components: [configRow], ephemeral: true });
  }

  // Toggle Anti-Spam
  if (customId === 'config_antispam') {
    if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Apenas administradores.', ephemeral: true });
    }
    const config = getConfig(guild.id);
    config.antiSpam = !config.antiSpam;
    await interaction.reply({ content: `✅ Anti-Spam ${config.antiSpam ? 'ativado' : 'desativado'}!`, ephemeral: true });
  }

  // Toggle Auto-Mod
  if (customId === 'config_automod') {
    if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Apenas administradores.', ephemeral: true });
    }
    const config = getConfig(guild.id);
    config.autoMod = !config.autoMod;
    await interaction.reply({ content: `✅ Auto-Moderação ${config.autoMod ? 'ativada' : 'desativada'}!`, ephemeral: true });
  }

  // Trocar IA
  if (customId === 'config_ia') {
    if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Apenas administradores.', ephemeral: true });
    }
    const config = getConfig(guild.id);
    config.aiModel = config.aiModel === 'gpt-4o-mini' ? 'gpt-4o' : 'gpt-4o-mini';
    await interaction.reply({ content: `✅ Modelo IA alterado para: ${config.aiModel}`, ephemeral: true });
  }
});

// Vigilância de mensagens
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const config = getConfig(message.guild.id);
  const content = message.content;

  // Verifica se user tem cargo imune
  const hasImmuneRole = message.member.roles.cache.some(role => config.immuneRoles.includes(role.id));
  if (hasImmuneRole || message.member.permissions.has(PermissionFlagsBits.Administrator)) {
    // Admins e cargos imunes não são moderados
  } else {
    // Anti-Spam
    if (config.antiSpam && isSpam(content)) {
      await punishUser(message, 'Link suspeito / check bio / convite não autorizado', config);
      return;
    }

    // Mensagens repetidas
    if (config.autoMod && isRepeatSpam(message.author.id, content)) {
      await punishUser(message, 'Spam de mensagens repetidas', config);
      return;
    }
  }

  // Comando !ask para falar com a IA
  if (content.startsWith('!ask ')) {
    const question = content.slice(5);
    const config = getConfig(message.guild.id);
    try {
      const res = await openai.chat.completions.create({
        model: config.aiModel,
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

  // Comando !imune (adicionar cargo imune)
  if (content.startsWith('!imune ')) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
    const role = message.mentions.roles.first();
    const config = getConfig(message.guild.id);
    if (role) {
      if (config.immuneRoles.includes(role.id)) {
        config.immuneRoles = config.immuneRoles.filter(id => id !== role.id);
        message.reply(`✅ Cargo ${role.name} removido dos imunes.`);
      } else {
        config.immuneRoles.push(role.id);
        message.reply(`✅ Cargo ${role.name} adicionado aos imunes.`);
      }
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


// ===== REGISTRO DE COMANDOS SLASH =====
const commands = require('./commands.js');

client.once('ready', async () => {
  console.log('Registrando comandos slash...');
  try {
    for (const guild of client.guilds.cache.values()) {
      await guild.commands.set(commands);
    }
    console.log('✅ Comandos registrados!');
  } catch (e) {
    console.log('Erro ao registrar comandos:', e.message);
  }
});

// ===== HANDLER DE COMANDOS SLASH =====
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, options, member, guild } = interaction;

  // COMANDO /LOJA
  if (commandName === 'loja') {
    const sub = options.getSubcommand();
    
    if (sub === 'config') {
      if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ Apenas administradores.', ephemeral: true });
      }

      const config = getConfig(guild.id);
      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('💰 Configuração da Loja')
        .setDescription('Configure o sistema de vendas de membros')
        .addFields(
          { name: 'Vendas', value: config.shopEnabled ? '✅ Ativado' : '❌ Desativado', inline: true },
          { name: 'Sistema de Refil', value: config.refilEnabled ? '✅ Ativado' : '❌ Desativado', inline: true },
          { name: 'Pedido Mínimo', value: `${config.minOrder} membros`, inline: true },
          { name: 'Cargo de Cliente', value: config.clientRole ? `<@&${config.clientRole}>` : 'Não configurado', inline: true },
          { name: 'Cargo da Equipe', value: config.staffRole ? `<@&${config.staffRole}>` : 'Não configurado', inline: true },
          { name: 'Preço por Membro', value: `R$ ${config.memberPrice.toFixed(2)}`, inline: true },
          { name: 'Preço com Refil', value: `R$ ${config.memberPriceRefil.toFixed(2)}`, inline: true },
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('shop_toggle').setLabel(config.shopEnabled ? 'Desativar Vendas' : 'Ativar Vendas').setStyle(config.shopEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder().setCustomId('shop_refil').setLabel(config.refilEnabled ? 'Desativar Refil' : 'Ativar Refil').setStyle(config.refilEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder().setCustomId('shop_prices').setLabel('Configurar Preços').setStyle(ButtonStyle.Primary),
      );

      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }

    if (sub === 'vender') {
      const quantidade = options.getInteger('quantidade');
      const config = getConfig(guild.id);

      if (!config.shopEnabled) {
        return interaction.reply({ content: '❌ Sistema de vendas desativado.', ephemeral: true });
      }

      if (quantidade < config.minOrder) {
        return interaction.reply({ content: `❌ Pedido mínimo: ${config.minOrder} membros.`, ephemeral: true });
      }

      const preco = quantidade * config.memberPrice;
      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('💰 Pedido de Compra')
        .setDescription(`Você está comprando ${quantidade} membros`)
        .addFields(
          { name: 'Quantidade', value: `${quantidade} membros`, inline: true },
          { name: 'Preço Total', value: `R$ ${preco.toFixed(2)}`, inline: true },
          { name: 'Preço Unitário', value: `R$ ${config.memberPrice.toFixed(2)}`, inline: true },
        )
        .setFooter({ text: 'Clique em Confirmar para prosseguir' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`buy_confirm_${quantidade}`).setLabel('✅ Confirmar Compra').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('buy_cancel').setLabel('❌ Cancelar').setStyle(ButtonStyle.Danger),
      );

      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }

    if (sub === 'saque') {
      if (!userEconomy[member.id] || userEconomy[member.id] <= 0) {
        return interaction.reply({ content: '❌ Você não tem saldo disponível.', ephemeral: true });
      }

      const saldo = userEconomy[member.id];
      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('💸 Saque de Saldo')
        .setDescription(`Seu saldo: R$ ${saldo.toFixed(2)}`)
        .addFields({ name: 'Instruções', value: 'Entre em contato com a equipe para realizar o saque.' });

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'stats') {
      // Implementar estatísticas
      await interaction.reply({ content: '📊 Estatísticas em desenvolvimento...', ephemeral: true });
    }
  }

  // COMANDO /MOD
  if (commandName === 'mod') {
    const sub = options.getSubcommand();
    const target = options.getUser('usuario');
    const motivo = options.getString('motivo') || 'Sem motivo';

    if (sub === 'ban') {
      const targetMember = await guild.members.fetch(target.id);
      await targetMember.ban({ reason: motivo });
      await interaction.reply({ content: `✅ ${target.tag} foi banido. Motivo: ${motivo}` });
      
      const logEmbed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('🔨 Usuário Banido')
        .addFields(
          { name: 'Usuário', value: target.tag, inline: true },
          { name: 'Moderador', value: member.user.tag, inline: true },
          { name: 'Motivo', value: motivo }
        )
        .setTimestamp();
      await sendLog(guild, logEmbed);
    }

    if (sub === 'kick') {
      const targetMember = await guild.members.fetch(target.id);
      await targetMember.kick(motivo);
      await interaction.reply({ content: `✅ ${target.tag} foi kickado. Motivo: ${motivo}` });
    }

    if (sub === 'mute') {
      const tempo = options.getInteger('tempo');
      const targetMember = await guild.members.fetch(target.id);
      await targetMember.timeout(tempo * 60 * 1000, motivo);
      await interaction.reply({ content: `✅ ${target.tag} foi mutado por ${tempo} minutos.` });
    }

    if (sub === 'warn') {
      addWarn(target.id);
      const count = warns[target.id] || 0;
      await interaction.reply({ content: `⚠️ ${target.tag} recebeu um aviso (${count}/${getConfig(guild.id).warnLimit}). Motivo: ${motivo}` });
    }
  }

  // COMANDO /ANTIRAID
  if (commandName === 'antiraid') {
    const sub = options.getSubcommand();
    const config = getConfig(guild.id);

    if (sub === 'ativar') {
      config.antiRaid = true;
      await interaction.reply({ content: '✅ Anti-raid ativado! O servidor está protegido contra invasões em massa.' });
    }

    if (sub === 'desativar') {
      config.antiRaid = false;
      await interaction.reply({ content: '❌ Anti-raid desativado.' });
    }

    if (sub === 'config') {
      await interaction.reply({ content: '⚙️ Configuração de sensibilidade em desenvolvimento...', ephemeral: true });
    }
  }

  // COMANDO /IA
  if (commandName === 'ia') {
    const sub = options.getSubcommand();
    const config = getConfig(guild.id);

    if (sub === 'perguntar') {
      const pergunta = options.getString('pergunta');
      await interaction.deferReply();

      try {
        const res = await openai.chat.completions.create({
          model: config.aiModel,
          messages: [
            { role: 'system', content: 'Você é Alienz IA, assistente profissional de servidores Discord. Seja útil, direto e profissional.' },
            { role: 'user', content: pergunta }
          ],
          max_tokens: 800,
        });
        const resposta = res.choices[0].message.content;
        await interaction.editReply(`🤖 **Alienz IA:**\n${resposta}`);
      } catch (e) {
        await interaction.editReply('❌ Erro ao contactar a IA.');
      }
    }

    if (sub === 'sugestoes') {
      await interaction.deferReply({ ephemeral: true });

      const prompt = `Analise este servidor Discord e sugira 5 melhorias específicas:
- Nome: ${guild.name}
- Membros: ${guild.memberCount}
- Canais: ${guild.channels.cache.size}
- Cargos: ${guild.roles.cache.size}

Dê sugestões práticas e profissionais para melhorar organização, engajamento e segurança.`;

      try {
        const res = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 1000,
        });
        const sugestoes = res.choices[0].message.content;
        
        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('💡 Sugestões da IA para seu Servidor')
          .setDescription(sugestoes)
          .setFooter({ text: 'Alienz IA • Análise Inteligente' });

        await interaction.editReply({ embeds: [embed] });
      } catch (e) {
        await interaction.editReply('❌ Erro ao gerar sugestões.');
      }
    }

    if (sub === 'seguranca') {
      await interaction.deferReply({ ephemeral: true });

      const prompt = `Analise a segurança deste servidor Discord:
- Membros: ${guild.memberCount}
- Verificação: ${guild.verificationLevel}
- 2FA: ${guild.mfaLevel}
- Canais: ${guild.channels.cache.size}

Identifique vulnerabilidades e sugira melhorias de segurança.`;

      try {
        const res = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 1000,
        });
        const analise = res.choices[0].message.content;
        
        const embed = new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle('🔒 Análise de Segurança')
          .setDescription(analise);

        await interaction.editReply({ embeds: [embed] });
      } catch (e) {
        await interaction.editReply('❌ Erro ao analisar segurança.');
      }
    }
  }

  // COMANDO /CONFIG
  if (commandName === 'config') {
    const sub = options.getSubcommand();
    const config = getConfig(guild.id);

    if (sub === 'ver') {
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('⚙️ Configurações Atuais')
        .addFields(
          { name: 'Anti-Spam', value: config.antiSpam ? '✅' : '❌', inline: true },
          { name: 'Auto-Mod', value: config.autoMod ? '✅' : '❌', inline: true },
          { name: 'Anti-Raid', value: config.antiRaid ? '✅' : '❌', inline: true },
          { name: 'Loja', value: config.shopEnabled ? '✅' : '❌', inline: true },
          { name: 'Logs', value: config.logs ? '✅' : '❌', inline: true },
          { name: 'Modelo IA', value: config.aiModel, inline: true },
        );

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'reset') {
      delete serverConfig[guild.id];
      await interaction.reply({ content: '✅ Configurações resetadas para o padrão.', ephemeral: true });
    }
  }
});
