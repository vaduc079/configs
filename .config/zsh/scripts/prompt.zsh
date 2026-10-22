# Expand only our prompt variables; branch names stay data, not shell code.
setopt prompt_subst
autoload -Uz add-zsh-hook

_duc_prompt_precmd() {
  local exit_status=$?
  local branch

  _duc_prompt_arrow='%B%F{green}❯%f%b'
  (( exit_status == 0 )) || _duc_prompt_arrow='%B%F{red}❯%f%b'

  _duc_prompt_git=''
  branch=$(command git branch --show-current 2>/dev/null) || return 0
  if [[ -z $branch ]]; then
    branch=$(command git rev-parse --short HEAD 2>/dev/null) || return 0
  fi

  (( ${#branch} <= 35 )) || branch="${branch[1,35]}…"
  # Percent signs have special meaning during Zsh's prompt rendering.
  _duc_prompt_git=" %B%F{magenta} ${branch//\%/%%}%f%b"
}

add-zsh-hook precmd _duc_prompt_precmd
PROMPT='%B%F{cyan}%(3~|.../|)%2~%f%b${_duc_prompt_git}'$'\n''${_duc_prompt_arrow} '
RPROMPT=''
