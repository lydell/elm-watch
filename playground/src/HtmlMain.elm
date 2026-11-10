module HtmlMain exposing (main)

-- LongExcerpts is not used, only imported so that it is compiled. It is for
-- trying out how long code excerpts in errors are collapsed.

import Html exposing (Html)
import LongExcerpts


main : Html msg
main =
    Html.text "This is just static HTML, rendered by Elm."
