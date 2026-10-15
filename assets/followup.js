export function conversationDraft(check, name) {
  const greeting=name ? 'Hi '+name+', ' : 'Hi, ';
  const assessment=check.verdict==='safe'
    ? 'Proteva did not spot obvious warning signs, but that does not confirm who sent it.'
    : 'Proteva noticed some warning signs. There is no need to rush into anything.';
  return greeting+'I checked that message with Proteva. '+assessment+
    '\n\nWould you like to look at it together? Before clicking links, sending money, or sharing personal details, we can contact the person or company using a number we already trust.'+
    '\n\nYou are in charge. I am here to help.';
}
