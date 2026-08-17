const uuidColumn = (Sequelize) => ({
  type: Sequelize.UUID,
  primaryKey: true,
  allowNull: false,
  defaultValue: Sequelize.UUIDV4,
})

const cascadeFk = (Sequelize, model) => ({
  type: Sequelize.UUID,
  allowNull: false,
  references: { model, key: 'id' },
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE',
})

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('users', {
      id: uuidColumn(Sequelize),
      email: { type: Sequelize.STRING, allowNull: true, unique: true },
      password_hash: { type: Sequelize.STRING, allowNull: true },
      oauth_provider: { type: Sequelize.STRING, allowNull: true },
      oauth_id: { type: Sequelize.STRING, allowNull: true },
      nickname: { type: Sequelize.STRING, allowNull: false },
      avatar_url: { type: Sequelize.STRING, allowNull: true },
      is_guest: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    })

    await queryInterface.createTable('word_decks', {
      id: uuidColumn(Sequelize),
      category: { type: Sequelize.STRING, allowNull: false },
      language: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING, allowNull: false },
    })

    await queryInterface.createTable('rooms', {
      id: uuidColumn(Sequelize),
      code: { type: Sequelize.CHAR(6), allowNull: false, unique: true },
      visibility: { type: Sequelize.ENUM('private', 'public'), allowNull: false },
      status: {
        type: Sequelize.ENUM('lobby', 'in_game', 'results'),
        allowNull: false,
        defaultValue: 'lobby',
      },
      host_id: cascadeFk(Sequelize, 'users'),
      max_players: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 10 },
      selected_game_id: { type: Sequelize.STRING, allowNull: true },
      invite_token: { type: Sequelize.UUID, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      closed_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    })
    // Supports the public room browser (list open, joinable rooms).
    await queryInterface.addIndex('rooms', ['visibility', 'status'], {
      name: 'rooms_visibility_status',
    })

    await queryInterface.createTable('room_members', {
      id: uuidColumn(Sequelize),
      room_id: cascadeFk(Sequelize, 'rooms'),
      user_id: cascadeFk(Sequelize, 'users'),
      is_ready: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      joined_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      left_at: { type: Sequelize.DATE, allowNull: true },
    })
    // Not a partial unique index on `leftAt IS NULL` (not portable) — the
    // application reuses the existing row on rejoin instead of inserting a
    // second row for the same (room, user) pair.
    await queryInterface.addIndex('room_members', ['room_id', 'user_id'], {
      unique: true,
      name: 'room_members_room_id_user_id',
    })

    await queryInterface.createTable('room_bans', {
      id: uuidColumn(Sequelize),
      room_id: cascadeFk(Sequelize, 'rooms'),
      user_id: cascadeFk(Sequelize, 'users'),
      banned_by: cascadeFk(Sequelize, 'users'),
      reason: { type: Sequelize.STRING, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    })
    await queryInterface.addIndex('room_bans', ['room_id', 'user_id'], {
      unique: true,
      name: 'room_bans_room_id_user_id',
    })

    await queryInterface.createTable('game_sessions', {
      id: uuidColumn(Sequelize),
      room_id: cascadeFk(Sequelize, 'rooms'),
      game_id: { type: Sequelize.STRING, allowNull: false },
      state: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      started_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      ended_at: { type: Sequelize.DATE, allowNull: true },
    })

    await queryInterface.createTable('game_results', {
      id: uuidColumn(Sequelize),
      session_id: cascadeFk(Sequelize, 'game_sessions'),
      user_id: cascadeFk(Sequelize, 'users'),
      score: { type: Sequelize.INTEGER, allowNull: false },
      placement: { type: Sequelize.INTEGER, allowNull: false },
    })

    await queryInterface.createTable('word_deck_entries', {
      id: uuidColumn(Sequelize),
      deck_id: cascadeFk(Sequelize, 'word_decks'),
      word: { type: Sequelize.STRING, allowNull: false },
    })

    await queryInterface.createTable('friendships', {
      id: uuidColumn(Sequelize),
      user_id: cascadeFk(Sequelize, 'users'),
      friend_id: cascadeFk(Sequelize, 'users'),
      status: { type: Sequelize.ENUM('pending', 'accepted', 'blocked'), allowNull: false },
    })
    await queryInterface.addIndex('friendships', ['user_id', 'friend_id'], {
      unique: true,
      name: 'friendships_user_id_friend_id',
    })

    await queryInterface.createTable('notifications', {
      id: uuidColumn(Sequelize),
      user_id: cascadeFk(Sequelize, 'users'),
      type: { type: Sequelize.STRING, allowNull: false },
      payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      read_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    })
  },

  async down(queryInterface) {
    // Reverse dependency order so FK constraints never block a drop.
    await queryInterface.dropTable('notifications')
    await queryInterface.dropTable('friendships')
    await queryInterface.dropTable('word_deck_entries')
    await queryInterface.dropTable('game_results')
    await queryInterface.dropTable('game_sessions')
    await queryInterface.dropTable('room_bans')
    await queryInterface.dropTable('room_members')
    await queryInterface.dropTable('rooms')
    await queryInterface.dropTable('word_decks')
    await queryInterface.dropTable('users')

    // queryInterface.dropTable() only auto-drops a Postgres ENUM type when a
    // model for that table is registered on the Sequelize instance. Plain
    // migrations never register models, so the ENUM types created by `up()`
    // survive the table drop and must be removed explicitly — otherwise
    // re-running `up()` fails with "type already exists".
    await queryInterface.dropEnum('enum_rooms_visibility')
    await queryInterface.dropEnum('enum_rooms_status')
    await queryInterface.dropEnum('enum_friendships_status')
  },
}
