const trainingRoutes = {
  bootstrap: 'training/bootstrap',
  freeSession: 'training/sessions/free',
  conversation: (id) => `training/conversations/${encodeURIComponent(id)}`,
};

module.exports = { trainingRoutes };
