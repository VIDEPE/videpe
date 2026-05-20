export const getInitialVisibility = (volumes) => {
  const visible = volumes.map(() => true);
  const mriIndex = volumes.findIndex((volume) => volume.type === 'MRI');
  const petIndex = volumes.findIndex((volume) => volume.type === 'PET');
  if (mriIndex !== -1 && petIndex !== -1) {
    visible[petIndex] = false;
  }
  return visible;
};

export const applyToggle = (volumes, visible, index) => {
  const next = [...visible];
  next[index] = !next[index];

  // MRI and PET are mutually exclusive — turning one on turns the other off
  const type = volumes[index]?.type;
  if (next[index] && (type === 'MRI' || type === 'PET')) {
    const linkedType = type === 'MRI' ? 'PET' : 'MRI';
    const linkedIndex = volumes.findIndex((volume) => volume.type === linkedType);
    if (linkedIndex !== -1) next[linkedIndex] = false;
  }

  return next;
};
