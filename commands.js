const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

// Registra comandos slash
const commands = [
  // LOJA
  new SlashCommandBuilder()
    .setName('loja')
    .setDescription('Sistema de vendas de membros')
    .addSubcommand(sub => sub.setName('config').setDescription('Configurar loja'))
    .addSubcommand(sub => sub.setName('vender').setDescription('Vender membros').addIntegerOption(opt => opt.setName('quantidade').setDescription('Quantidade de membros').setRequired(true)))
    .addSubcommand(sub => sub.setName('saque').setDescription('Sacar saldo'))
    .addSubcommand(sub => sub.setName('stats').setDescription('Ver estatísticas')),

  // MODERAÇÃO
  new SlashCommandBuilder()
    .setName('mod')
    .setDescription('Comandos de moderação')
    .addSubcommand(sub => sub.setName('ban').setDescription('Banir usuário').addUserOption(opt => opt.setName('usuario').setDescription('Usuário').setRequired(true)).addStringOption(opt => opt.setName('motivo').setDescription('Motivo')))
    .addSubcommand(sub => sub.setName('kick').setDescription('Kickar usuário').addUserOption(opt => opt.setName('usuario').setDescription('Usuário').setRequired(true)).addStringOption(opt => opt.setName('motivo').setDescription('Motivo')))
    .addSubcommand(sub => sub.setName('mute').setDescription('Mutar usuário').addUserOption(opt => opt.setName('usuario').setDescription('Usuário').setRequired(true)).addIntegerOption(opt => opt.setName('tempo').setDescription('Tempo em minutos').setRequired(true)))
    .addSubcommand(sub => sub.setName('warn').setDescription('Avisar usuário').addUserOption(opt => opt.setName('usuario').setDescription('Usuário').setRequired(true)).addStringOption(opt => opt.setName('motivo').setDescription('Motivo').setRequired(true)))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  // ANTI-RAID
  new SlashCommandBuilder()
    .setName('antiraid')
    .setDescription('Sistema anti-raid')
    .addSubcommand(sub => sub.setName('ativar').setDescription('Ativar anti-raid'))
    .addSubcommand(sub => sub.setName('desativar').setDescription('Desativar anti-raid'))
    .addSubcommand(sub => sub.setName('config').setDescription('Configurar sensibilidade'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // IA
  new SlashCommandBuilder()
    .setName('ia')
    .setDescription('Assistente IA')
    .addSubcommand(sub => sub.setName('perguntar').setDescription('Fazer pergunta à IA').addStringOption(opt => opt.setName('pergunta').setDescription('Sua pergunta').setRequired(true)))
    .addSubcommand(sub => sub.setName('sugestoes').setDescription('IA analisa e sugere melhorias'))
    .addSubcommand(sub => sub.setName('seguranca').setDescription('IA analisa segurança do servidor')),

  // CONFIG
  new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configurações do bot')
    .addSubcommand(sub => sub.setName('ver').setDescription('Ver configurações atuais'))
    .addSubcommand(sub => sub.setName('reset').setDescription('Resetar configurações'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // BACKUP
  new SlashCommandBuilder()
    .setName('backup')
    .setDescription('Sistema de backup')
    .addSubcommand(sub => sub.setName('criar').setDescription('Criar backup do servidor'))
    .addSubcommand(sub => sub.setName('restaurar').setDescription('Restaurar backup').addStringOption(opt => opt.setName('id').setDescription('ID do backup').setRequired(true)))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];

module.exports = commands;
